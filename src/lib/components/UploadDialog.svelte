<script lang="ts">
	let {
		uploadSettingsDialog = $bindable<HTMLDialogElement | undefined>(undefined),
		uploadDialog = $bindable<HTMLDialogElement | undefined>(undefined),
		uploadFiles,
		uploadFileCount,
		uploadMode = $bindable<'all' | 'targets'>('all'),
		uploadTargets = $bindable<(number | undefined)[]>([]),
		uploadPending,
		uploadError,
		uploadStatus,
		uploadProgress,
		uploadProgressMax,
		formMessage,
		closeUploadSettings,
		closeUploadResult,
		includePronunciation = $bindable(true)
	}: {
		uploadSettingsDialog?: HTMLDialogElement;
		uploadDialog?: HTMLDialogElement;
		uploadFiles: File[];
		uploadFileCount: number;
		uploadMode?: 'all' | 'targets';
		uploadTargets?: (number | undefined)[];
		uploadPending: boolean;
		uploadError: string;
		uploadStatus: string;
		uploadProgress: number | undefined;
		uploadProgressMax: number;
		formMessage?: string;
		closeUploadSettings: () => void;
		closeUploadResult: () => void;
		includePronunciation?: boolean;
	} = $props();
</script>

<dialog
	bind:this={uploadSettingsDialog}
	class="modal"
	aria-labelledby="upload-settings-title"
	oncancel={closeUploadSettings}
>
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="upload-settings-title">사진 추가</h2>
				<p>{uploadFileCount}장의 사진에서 단어를 추출합니다.</p>
			</div>
			<button
				class="modal-close"
				type="button"
				aria-label="닫기"
				title="닫기"
				onclick={closeUploadSettings}>×</button
			>
		</div>

		<div class="form-stack">
			<fieldset class="choice-group">
				<legend>추출 방식</legend>
				<label class="choice"
					><input type="radio" bind:group={uploadMode} value="all" /> 사진에 보이는 주요 단어 전체 추출</label
				>
				<label class="choice"
					><input type="radio" bind:group={uploadMode} value="targets" /> 사진별 목표 개수 지정</label
				>
			</fieldset>
			{#if uploadMode === 'targets'}
				<div class="form-stack">
					{#each uploadFiles as file, index (file)}
						<div class="field">
							<label for={`upload-target-${index}`}>사진 {index + 1} 목표 개수 ({file.name})</label>
							<input
								id={`upload-target-${index}`}
								name="targetWordCounts"
								form="photo-upload-form"
								type="number"
								min="1"
								max="500"
								step="1"
								inputmode="numeric"
								required
								bind:value={uploadTargets[index]}
							/>
						</div>
					{/each}
					<p class="field-note" aria-live="polite">
						총 목표 개수: {uploadTargets.reduce(
							(total, target) => (total ?? 0) + (target ?? 0),
							0
						)}개
					</p>
				</div>
			{/if}
			<label class="choice" style="width:fit-content">
				<input type="checkbox" bind:checked={includePronunciation} style="width:16px;height:16px" /> 발음
				기호 함께 가져오기
			</label>
			<p class="field-note" style="margin-top:6px">해제하면 발음 기호 없이 단어만 저장됩니다.</p>
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={closeUploadSettings}
					>취소</button
				>
				<button class="button button-primary" type="submit" form="photo-upload-form"
					>사진 분석</button
				>
			</div>
		</div>
	</div>
</dialog>

<dialog
	bind:this={uploadDialog}
	class="modal"
	aria-labelledby="ocr-progress-title"
	aria-describedby="ocr-progress-description"
	oncancel={(event) => event.preventDefault()}
>
	<div class="modal-body ocr-modal-body">
		<h2 id="ocr-progress-title">{uploadPending ? '사진 추가 중' : '사진 분석 실패'}</h2>
		{#if uploadPending}
			<p id="ocr-progress-description" class="ocr-status" role="status" aria-live="polite">
				{uploadStatus || `${uploadFileCount}장의 사진을 준비하는 중`}
			</p>
			{#if uploadProgress === undefined}
				<progress class="ocr-progress" aria-label={uploadStatus || '사진 준비 중'}></progress>
			{:else}
				<progress
					class="ocr-progress"
					aria-label={uploadStatus}
					value={uploadProgress}
					max={uploadProgressMax}
				></progress>
			{/if}
			<p class="ocr-warning">
				새로고침하거나 창을 닫지 마세요. 분석 결과가 저장되지 않을 수 있어요.
			</p>
		{:else}
			<p id="ocr-progress-description">사진 분석을 완료하지 못했습니다.</p>
			<p class="message message-error" role="alert" aria-live="assertive">
				{uploadError || formMessage || '잠시 후 다시 시도해 주세요.'}
			</p>
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={closeUploadResult}
					>닫기</button
				>
			</div>
		{/if}
	</div>
</dialog>
