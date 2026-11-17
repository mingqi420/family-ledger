// 确认弹窗：模板与组件绑定；账本数据由根应用统一管理。
const ConfirmDialog = {
  name: 'ConfirmDialog',
  setup() {
    return LedgerContext.use(['modal', 'busy', 'ready', 'closeOverlay', 'confirmModal']);
  },
  template: `
<div class="modal-mask" @click.self="closeOverlay">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="t" id="modal-title">{{ modal.title }}</div>
    <div class="d">{{ modal.desc }}</div>
    <div class="btns">
      <button class="cancel" @click="closeOverlay" :disabled="busy">取消</button>
      <button class="ok" :class="{blue: modal.blue}" @click="confirmModal" :disabled="busy || !ready">{{ busy ? '正在保存…' : modal.okText }}</button>
    </div>
  </div>
</div>
`,
};
