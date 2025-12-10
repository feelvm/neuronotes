<script lang="ts">
    import { browser } from '$app/environment';
    import * as db from '$lib/db';
    import { generateUUID } from '$lib/utils/uuid';
    import type { Workspace } from '$lib/db_types';

    export let open = false;
    export let signupEmail = '';
    export let signupPassword = '';
    export let signupRepeatPassword = '';
    export let isSignupEmailInvalid = false;
    export let isPasswordMismatch = false;
    export let isPasswordInvalid = false;

    // Callbacks
    export let onClose: () => void;
    export let onOpenLogin: () => void;
    export let onSignupSuccess: (userId: string) => Promise<void>;

    // Supabase modules (loaded dynamically)
    let auth: typeof import('$lib/supabase/auth');
    let sync: typeof import('$lib/supabase/sync');
    let migrations: typeof import('$lib/supabase/migrations');

    // Helper function to load Supabase modules if not already loaded
    async function ensureSupabaseLoaded() {
        if (!auth) {
            const authModule = await import('$lib/supabase/auth');
            auth = authModule;
            sync = await import('$lib/supabase/sync');
            migrations = await import('$lib/supabase/migrations');
        }
    }

    function validateEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    function validatePassword(password: string): boolean {
        return password.length >= 8;
    }

    function handleEmailBlur() {
        if (signupEmail && !validateEmail(signupEmail)) {
            isSignupEmailInvalid = true;
        } else {
            isSignupEmailInvalid = false;
        }
    }

    function handlePasswordBlur() {
        if (signupPassword && !validatePassword(signupPassword)) {
            isPasswordInvalid = true;
        } else {
            isPasswordInvalid = false;
        }
        if (signupRepeatPassword && signupPassword !== signupRepeatPassword) {
            isPasswordMismatch = true;
        } else if (signupPassword && signupRepeatPassword && signupPassword === signupRepeatPassword) {
            isPasswordMismatch = false;
        }
    }

    function handleRepeatPasswordBlur() {
        if (signupRepeatPassword && signupPassword !== signupRepeatPassword) {
            isPasswordMismatch = true;
        } else {
            isPasswordMismatch = false;
        }
        // Clear password invalid state if password is valid and matches
        if (signupPassword && validatePassword(signupPassword) && signupPassword === signupRepeatPassword) {
            isPasswordInvalid = false;
        }
    }

    async function handleSubmit() {
        if (!signupEmail || !signupPassword || !signupRepeatPassword) return;
        
        // Validate email and password
        if (!validateEmail(signupEmail)) {
            isSignupEmailInvalid = true;
            return;
        }
        
        if (!validatePassword(signupPassword)) {
            isPasswordInvalid = true;
            return;
        }
        
        if (signupPassword !== signupRepeatPassword) {
            isPasswordMismatch = true;
            return;
        }
        
        try {
            await ensureSupabaseLoaded();
            if (!auth) {
                alert('Authentication module failed to load. Please refresh the page.');
                return;
            }
            
            const result = await auth.signUp(signupEmail, signupPassword);
            
            if (!result.success) {
                alert(result.error || 'Signup failed');
                return;
            }
            
            if (result.success && result.user) {
                // Check if email confirmation is required (no session means email confirmation needed)
                if (!result.session) {
                    // Email confirmation required - show message and close modal
                    alert('Account created successfully! Please check your email and click the confirmation link to complete your registration. Once confirmed, you can log in.');
                    
                    // Reset form
                    signupEmail = '';
                    signupPassword = '';
                    signupRepeatPassword = '';
                    isSignupEmailInvalid = false;
                    isPasswordInvalid = false;
                    isPasswordMismatch = false;
                    onClose();
                    return;
                }
                
                // User is fully authenticated (has session) - proceed with sync
                const newUserId = result.user.id;
                
                // IMPORTANT: Check if migration is needed BEFORE clearing data
                // This check must happen before clearAllLocalData() or it will always return false
                // Flush any pending saves first to ensure we have the latest data
                await db.flushDatabaseSave();
                const needsMigrate = await migrations.needsMigration();
                
                if (needsMigrate) {
                    // Migrate BEFORE clearing - this pushes local data to Supabase
                    const migrationResult = await migrations.migrateLocalDataToSupabase();
                    if (migrationResult.success) {
                    } else {
                        console.error('Migration failed:', migrationResult.error);
                    }
                }
                
                // Now clear all local data before pulling new user's data
                await db.clearAllLocalData();
                
                // Store new user ID
                if (browser && newUserId) {
                    localStorage.setItem('neuronotes_current_user_id', newUserId);
                }
                
                // IMPORTANT: After clearing local data, we should ONLY pull from Supabase, not push
                // Using fullSync() would push the empty local state and delete everything from Supabase!
                // So we use pullFromSupabase() instead to restore the user's data
                const pullResult = await sync.pullFromSupabase();
                if (!pullResult.success) {
                    console.error('Failed to pull data from Supabase:', pullResult.error);
                    alert(`Warning: Failed to restore your data from cloud. Error: ${pullResult.error}`);
                } else {
                    // Flush database to ensure all pulled data is persisted
                    await db.flushDatabaseSave();
                    // Verify data was pulled by checking workspaces
                    const pulledWorkspaces = await db.getAllWorkspaces();
                    if (pulledWorkspaces.length === 0) {
                        console.warn('No workspaces found in Supabase for this user - data may not exist in cloud');
                        // For new signups, this is expected - they don't have data yet
                    }
                }
                
                // Call the parent's onSignupSuccess callback
                await onSignupSuccess(newUserId);
                
                // Reset form
                signupEmail = '';
                signupPassword = '';
                signupRepeatPassword = '';
                isSignupEmailInvalid = false;
                isPasswordInvalid = false;
                isPasswordMismatch = false;
                onClose();
            }
        } catch (error) {
            console.error('Signup error:', error);
            alert(`Signup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
</script>

{#if open}
    <div 
        class="login-modal-overlay" 
        role="button"
        tabindex="0"
        on:click={onClose}
        on:keydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        }}
    >
        <div 
            class="login-modal" 
            role="dialog"
            aria-modal="true"
            aria-labelledby="signup-modal-title"
            tabindex="-1"
            on:click|stopPropagation
            on:keydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                }
            }}
        >
            <div class="login-modal-header">
                <h2 id="signup-modal-title">Sign Up</h2>
                <button class="login-modal-close" on:click={onClose}>×</button>
            </div>
            <div class="login-modal-content">
                <form on:submit|preventDefault={handleSubmit}>
                    <div class="login-field">
                        <label for="signup-email">Email</label>
                        <input
                            id="signup-email"
                            type="email"
                            class:invalid={isSignupEmailInvalid}
                            bind:value={signupEmail}
                            placeholder="Enter your email"
                            required
                            on:blur={handleEmailBlur}
                            on:input={() => {
                                if (isSignupEmailInvalid && signupEmail && validateEmail(signupEmail)) {
                                    isSignupEmailInvalid = false;
                                }
                            }}
                        />
                    </div>
                    <div class="login-field">
                        <label for="signup-password">Password</label>
                        <input
                            id="signup-password"
                            type="password"
                            class:invalid={isPasswordInvalid}
                            bind:value={signupPassword}
                            placeholder="Enter your password (min 8 characters)"
                            required
                            on:blur={handlePasswordBlur}
                            on:input={() => {
                                if (isPasswordInvalid && signupPassword && validatePassword(signupPassword)) {
                                    isPasswordInvalid = false;
                                }
                                if (signupRepeatPassword && signupPassword !== signupRepeatPassword) {
                                    isPasswordMismatch = true;
                                } else if (signupRepeatPassword && signupPassword === signupRepeatPassword) {
                                    isPasswordMismatch = false;
                                    // Clear password invalid state if password is valid and matches
                                    if (validatePassword(signupPassword)) {
                                        isPasswordInvalid = false;
                                    }
                                }
                            }}
                        />
                    </div>
                    <div class="login-field">
                        <label for="signup-repeat-password">Repeat Password</label>
                        <input
                            id="signup-repeat-password"
                            type="password"
                            class:invalid={isPasswordMismatch}
                            bind:value={signupRepeatPassword}
                            placeholder="Repeat your password"
                            required
                            on:blur={handleRepeatPasswordBlur}
                            on:input={() => {
                                if (signupRepeatPassword && signupPassword !== signupRepeatPassword) {
                                    isPasswordMismatch = true;
                                } else {
                                    isPasswordMismatch = false;
                                }
                                // Clear password invalid state if password is valid and matches
                                if (signupPassword && validatePassword(signupPassword) && signupPassword === signupRepeatPassword) {
                                    isPasswordInvalid = false;
                                }
                            }}
                        />
                    </div>
                    <div class="login-actions">
                        <button type="submit" class="login-submit-btn">Register</button>
                        <button type="button" class="login-signup-btn" on:click={() => {
                            onClose();
                            onOpenLogin();
                        }}>Back to Login</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
{/if}

<style>
    .login-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    }

    .login-modal {
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 12px;
        width: 90%;
        max-width: 400px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    .login-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid var(--border);
    }

    .login-modal-header h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
    }

    .login-modal-close {
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: var(--text);
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
    }

    .login-modal-close:hover {
        background: var(--border);
    }

    .login-modal-content {
        padding: 20px;
    }

    .login-field {
        margin-bottom: 20px;
    }

    .login-field label {
        display: block;
        margin-bottom: 8px;
        font-size: 14px;
        font-weight: 500;
        color: var(--text);
    }

    .login-field input[type="email"],
    .login-field input[type="password"] {
        width: 100%;
        padding: 10px 12px;
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text);
        font-size: 14px;
        transition: border-color 0.2s, background-color 0.2s;
        box-sizing: border-box;
    }

    .login-field input[type="email"]:focus,
    .login-field input[type="password"]:focus {
        outline: none;
        border-color: var(--accent-red);
    }

    .login-field input[type="email"].invalid,
    .login-field input[type="password"].invalid {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.1);
    }

    .login-field input[type="email"].invalid:focus,
    .login-field input[type="password"].invalid:focus {
        border-color: var(--accent-red);
        background: rgba(255, 71, 87, 0.15);
    }

    .login-actions {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .login-submit-btn,
    .login-signup-btn {
        flex: 1;
        padding: 12px 20px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .login-submit-btn {
        background: var(--accent-red);
        color: white;
    }

    .login-submit-btn:hover {
        background: #ff3838;
    }

    .login-signup-btn {
        background: var(--panel-bg-darker);
        border: 1px solid var(--border);
        color: var(--text);
    }

    .login-signup-btn:hover {
        background: var(--border);
    }
</style>

