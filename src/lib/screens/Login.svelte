<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';

  let { onLogin }: { onLogin: (user: { user_id: number; user_name: string }) => void } = $props();

  let nameInput: HTMLInputElement | undefined = $state();

  onMount(() => {
    nameInput?.focus();
  });

  let name = $state('');
  let error = $state('');
  let loading = $state(false);

  async function doLogin() {
    const trimmed = name.trim();
    if (!trimmed) return;

    loading = true;
    error = '';
    try {
      const user = await invoke<{ user_id: number; user_name: string }>('login', { username: trimmed });
      onLogin(user);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-container">
  <div class="login-card">
    <div class="login-header">
      <h1>Bastidores GAL</h1>
      <p class="subtitle">Sistema de Gestión</p>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); doLogin(); }} class="login-form">
      <label for="name">Ingresa tu Nombre</label>
      <input
        id="name"
        type="text"
        bind:value={name}
        bind:this={nameInput}
        placeholder="Tu nombre..."
        disabled={loading}
      />

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <button type="submit" disabled={loading || !name.trim()}>
        {loading ? 'Ingresando...' : 'INGRESAR'}
      </button>
    </form>
  </div>
</div>

<style>
  .login-container {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%);
  }
  .login-card {
    background: white;
    border-radius: 0.857rem;
    padding: 2.857rem;
    width: 24.286rem;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  }
  .login-header {
    text-align: center;
    margin-bottom: 1.714rem;
  }
  .login-header h1 {
    margin: 0;
    font-size: 1.714rem;
    color: #2c3e50;
  }
  .subtitle {
    color: #7f8c8d;
    margin: 0.286rem 0 0;
    font-size: 1rem;
  }
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
  }
  label {
    font-size: 1rem;
    color: #555;
    font-weight: 500;
  }
  input {
    padding: 0.714rem 1rem;
    border: 2px solid #ddd;
    border-radius: 0.571rem;
    font-size: 1.071rem;
    text-align: center;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus {
    border-color: #3498db;
  }
  button {
    padding: 0.857rem;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 0.571rem;
    font-size: 1.071rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  button:hover:not(:disabled) { background: #0056b3; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .error { color: #e74c3c; font-size: 0.929rem; margin: 0; text-align: center; }
</style>
