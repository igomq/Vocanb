<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props();
	let pending = $state(false);

	const enhanceLogin: SubmitFunction = () => {
		pending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				pending = false;
			}
		};
	};
</script>

<svelte:head>
	<title>로그인 · Vocanb</title>
</svelte:head>

<main class="login-page">
	<section class="login-panel" aria-labelledby="login-title">
		<div class="brand" aria-label="Vocanb">
			<span>Vocanb</span>
			<small>단어장</small>
		</div>

		<h1 id="login-title">다시 만나요</h1>
		<p class="page-description">단어를 차분하게 모으고, 필요한 만큼만 복습하세요.</p>

		{#if form?.message}
			<p class="message message-error" role="alert" aria-live="assertive">{form.message}</p>
		{/if}

		<form method="post" use:enhance={enhanceLogin} class="form-stack" aria-label="로그인">
			<input type="hidden" name="next" value={data.next} />
			<div class="field">
				<label for="username">아이디</label>
				<input id="username" name="username" type="text" autocomplete="username" required />
			</div>
			<div class="field">
				<label for="password">비밀번호</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>
			<button class="button button-primary" type="submit" disabled={pending}>
				{pending ? '확인 중…' : '로그인'}
			</button>
		</form>
	</section>
</main>
