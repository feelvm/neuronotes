<script lang="ts">
    import { browser } from '$app/environment';
    import * as db from '$lib/db';
    import { generateUUID } from '$lib/utils/uuid';
    import type { Workspace } from '$lib/db_types';

    export let open = false;
    export let loginEmail = '';
    export let loginPassword = '';
    export let rememberMe = false;
    export let isEmailInvalid = false;

    // Callbacks
    export let onClose: () => void;
    export let onOpenSignup: () => void;
    export let onLoginSuccess: (userId: string) => Promise<void>;

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

    function handleEmailBlur() {
        if (loginEmail && !validateEmail(loginEmail)) {
            isEmailInvalid = true;
        } else {
            isEmailInvalid = false;
        }
    }

    async function handleSubmit() {
        if (!loginEmail || !loginPassword) return;
        
        try {
            await ensureSupabaseLoaded();
            if (!auth) {
                alert('Authentication module failed to load. Please refresh the page.');
                return;
            }
            
            const result = await auth.signIn(loginEmail, loginPassword, rememberMe);
            
            if (!result.success) {
                alert(result.error || 'Failed to sign in. Please check your credentials.');
                return;
            }
            
            if (result.success && result.user) {
                const newUserId = result.user.id;
                
                const previousUserId = browser ? localStorage.getItem('neuronotes_current_user_id') : null;
                const isSwitchingUsers = previousUserId && previousUserId !== newUserId;
                
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
                        alert('No data found in cloud for this account. If you had data before, it may have been lost. Please restore from a backup if available.');
                    }
                }
                
                await onLoginSuccess(newUserId);
                
                loginEmail = '';
                loginPassword = '';
                isEmailInvalid = false;
                onClose();
            }
        } catch (error) {
            console.error('Login error:', error);
            alert(`Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async function handleGoogleLogin() {
        try {
            await ensureSupabaseLoaded();
            if (!auth) {
                alert('Authentication module failed to load. Please refresh the page.');
                return;
            }
            
            const result = await auth.signInWithGoogle();
            if (!result.success) {
                alert(result.error || 'Failed to sign in with Google');
            }
        } catch (error) {
            console.error('Google login error:', error);
            alert(`Google login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
            aria-labelledby="login-modal-title"
            tabindex="-1"
            on:click|stopPropagation
            on:keydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                }
            }}
        >
            <div class="login-modal-header">
                <h2 id="login-modal-title">Login</h2>
                <button class="login-modal-close" on:click={onClose}>×</button>
            </div>
            <div class="login-modal-content">
                <form on:submit|preventDefault={handleSubmit}>
                    <div class="login-field">
                        <label for="login-email">Email</label>
                        <input
                            id="login-email"
                            type="email"
                            class:invalid={isEmailInvalid}
                            bind:value={loginEmail}
                            placeholder="Enter your email"
                            required
                            on:blur={handleEmailBlur}
                            on:input={() => {
                                if (isEmailInvalid && loginEmail && validateEmail(loginEmail)) {
                                    isEmailInvalid = false;
                                }
                            }}
                        />
                    </div>
                    <div class="login-field">
                        <label for="login-password">Password</label>
                        <input
                            id="login-password"
                            type="password"
                            bind:value={loginPassword}
                            placeholder="Enter your password"
                            required
                        />
                    </div>
                    <div class="login-field checkbox-field">
                        <label>
                            <input type="checkbox" bind:checked={rememberMe} />
                            <span>Remember me</span>
                        </label>
                    </div>
                    <div class="login-actions">
                        <button type="submit" class="login-submit-btn">Login</button>
                        <div class="login-divider">
                            <span>or</span>
                        </div>
                        <button 
                            type="button" 
                            class="login-google-btn"
                            on:click={handleGoogleLogin}
                        >
                            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                                <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.348 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
                                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
                            </svg>
                            Sign in with Google
                        </button>
                        <button type="button" class="login-signup-btn" on:click={() => {
                            onClose();
                            onOpenSignup();
                        }}>Sign Up</button>
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

    .login-field.checkbox-field {
        margin-bottom: 24px;
    }

    .login-field.checkbox-field label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        margin-bottom: 0;
    }

    .login-field.checkbox-field input[type="checkbox"] {
        width: auto;
        cursor: pointer;
    }

    .login-actions {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .login-divider {
        display: flex;
        align-items: center;
        text-align: center;
        margin: 8px 0;
    }

    .login-divider::before,
    .login-divider::after {
        content: '';
        flex: 1;
        border-bottom: 1px solid var(--border);
    }

    .login-divider span {
        padding: 0 12px;
        color: var(--text-secondary);
        font-size: 13px;
    }

    .login-google-btn {
        width: 100%;
        padding: 10px 16px;
        background: white;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: #3c4043;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        transition: background-color 0.2s, box-shadow 0.2s;
    }

    .login-google-btn:hover {
        background: #f8f9fa;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .login-google-btn:active {
        background: #f1f3f4;
    }

    .login-google-btn svg {
        flex-shrink: 0;
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

