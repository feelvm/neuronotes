<script lang="ts">
    import { browser } from '$app/environment';
    import * as db from '$lib/db';
    import { generateUUID } from '$lib/utils/uuid';
    import { validatePassword as validatePasswordUtil } from '$lib/utils/security';
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

    let auth: typeof import('$lib/supabase/auth');
    let sync: typeof import('$lib/supabase/sync');
    let migrations: typeof import('$lib/supabase/migrations');

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
        const result = validatePasswordUtil(password);
        return result.valid;
    }
    
    let passwordErrors: string[] = [];

    function handleEmailBlur() {
        if (signupEmail && !validateEmail(signupEmail)) {
            isSignupEmailInvalid = true;
        } else {
            isSignupEmailInvalid = false;
        }
    }

    function handlePasswordBlur() {
        if (signupPassword) {
            const validation = validatePasswordUtil(signupPassword);
            isPasswordInvalid = !validation.valid;
            passwordErrors = validation.errors;
        } else {
            isPasswordInvalid = false;
            passwordErrors = [];
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
        if (signupPassword && validatePassword(signupPassword) && signupPassword === signupRepeatPassword) {
            isPasswordInvalid = false;
        }
    }

    async function handleSubmit() {
        if (!signupEmail || !signupPassword || !signupRepeatPassword) return;
        
        if (!validateEmail(signupEmail)) {
            isSignupEmailInvalid = true;
            return;
        }
        
        const passwordValidation = validatePasswordUtil(signupPassword);
        if (!passwordValidation.valid) {
            isPasswordInvalid = true;
            passwordErrors = passwordValidation.errors;
            alert(`Password validation failed:\n${passwordValidation.errors.join('\n')}`);
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
                if (!result.session) {
                    alert('Account created successfully! Please check your email and click the confirmation link to complete your registration. Once confirmed, you can log in.');
                    
                    signupEmail = '';
                    signupPassword = '';
                    signupRepeatPassword = '';
                    isSignupEmailInvalid = false;
                    isPasswordInvalid = false;
                    isPasswordMismatch = false;
                    onClose();
                    return;
                }
                
                const newUserId = result.user.id;
                
                await db.flushDatabaseSave();
                const needsMigrate = await migrations.needsMigration();
                
                if (needsMigrate) {
                    const migrationResult = await migrations.migrateLocalDataToSupabase();
                    if (migrationResult.success) {
                    } else {
                        console.error('Migration failed:', migrationResult.error);
                    }
                }
                
                await db.clearAllLocalData();
                
                if (browser && newUserId) {
                    localStorage.setItem('neuronotes_current_user_id', newUserId);
                }
                
                const pullResult = await sync.pullFromSupabase();
                if (!pullResult.success) {
                    console.error('Failed to pull data from Supabase:', pullResult.error);
                    alert(`Warning: Failed to restore your data from cloud. Error: ${pullResult.error}`);
                } else {
                    await db.flushDatabaseSave();
                    const pulledWorkspaces = await db.getAllWorkspaces();
                    if (pulledWorkspaces.length === 0) {
                        console.warn('No workspaces found in Supabase for this user - data may not exist in cloud');
                    }
                }
                
                await onSignupSuccess(newUserId);
                
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
                            autocomplete="email"
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
                            placeholder="Enter your password (min 12 characters, mixed case, numbers, special chars)"
                            required
                            on:blur={handlePasswordBlur}
                            on:input={() => {
                                if (signupPassword) {
                                    const validation = validatePasswordUtil(signupPassword);
                                    isPasswordInvalid = !validation.valid;
                                    passwordErrors = validation.errors;
                                }
                                if (signupRepeatPassword && signupPassword !== signupRepeatPassword) {
                                    isPasswordMismatch = true;
                                } else if (signupRepeatPassword && signupPassword === signupRepeatPassword) {
                                    isPasswordMismatch = false;
                                    if (signupPassword) {
                                        const validation = validatePasswordUtil(signupPassword);
                                        isPasswordInvalid = !validation.valid;
                                        passwordErrors = validation.errors;
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
                                if (signupPassword && signupPassword === signupRepeatPassword) {
                                    const validation = validatePasswordUtil(signupPassword);
                                    isPasswordInvalid = !validation.valid;
                                    passwordErrors = validation.errors;
                                }
                            }}
                        />
                        {#if isPasswordInvalid && passwordErrors.length > 0}
                            <div style="font-size: 12px; color: var(--accent-red); margin-top: 4px;">
                                {#each passwordErrors as error}
                                    <div>{error}</div>
                                {/each}
                            </div>
                        {/if}
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
        font-size: 16px;
        transform: scale(0.875);
        transform-origin: left center;
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

