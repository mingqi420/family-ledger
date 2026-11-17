// 设置页：模板与组件绑定；账本数据由根应用统一管理。
const SettingsPage = {
  name: 'SettingsPage',
  setup() {
    const bindings = LedgerContext.use(['members', 'removeMember', 'busy', 'ready', 'newMember', 'addMember', 'exportJSON', 'exportCSV', 'hasLegacy', 'exportLegacy', 'importJSON', 'confirmClear', 'records', 'canWrite']);
    const fileInput = Vue.ref(null);
    function triggerImport() {
      if (bindings.canWrite()) fileInput.value?.click();
    }
    return { ...bindings, fileInput, triggerImport };
  },
  template: `
<div class="page">
  <div class="topbar"><h1>设置</h1></div>

  <div class="card">
    <h3>家庭成员</h3>
    <div>
      <span class="member-pill" v-for="m in members" :key="m">
        <b>{{ m }}</b>
        <button v-if="members.length>1" @click="removeMember(m)" :disabled="busy || !ready" :aria-label="'删除成员' + m">✕</button>
      </span>
    </div>
    <div class="form-line" style="margin-bottom:0">
      <input class="input" v-model="newMember" placeholder="输入成员名字，如：明奇" aria-label="新增成员名字" maxlength="32" @keyup.enter="addMember">
      <button class="btn primary" style="width:auto;padding:10px 18px;margin:0" @click="addMember" :disabled="busy || !ready">添加</button>
    </div>
  </div>

  <div class="card">
    <h3>数据备份</h3>
    <div class="tip-box" style="margin-bottom:6px">正式数据保存在本机 SQLite 数据库中，浏览器只保留只读缓存。请定期导出 JSON 备份并存放到其他设备；恢复会覆盖当前记录。</div>
    <button class="btn primary" @click="exportJSON">导出备份（JSON）</button>
    <button class="btn ghost" @click="exportCSV">导出流水（CSV，Excel 可打开）</button>
    <button class="btn ghost" @click="triggerImport" :disabled="busy || !ready">从备份文件恢复</button>
    <button class="btn ghost" v-if="hasLegacy" @click="exportLegacy">导出旧版浏览器备份（不覆盖数据库）</button>
    <div class="tip-box" v-if="!ready">当前未连接服务，导出内容仅为页面缓存，可能不是最新账本。</div>
    <input type="file" accept=".json" ref="fileInput" style="display:none" @change="importJSON">
  </div>

  <div class="card">
    <h3>记账规则说明</h3>
    <div class="tip-box">
      · <b>计入账单</b>：支出（−）、收入（+）、理财收益（+，计入结余）<br>
      · <b>仅记录不计入</b>：理财买入/赎回（本金流转）、家庭内部转账（成员之间资金转移，不影响家庭总资产）<br>
      · 月账单 = 当月收入 + 当月理财收益 − 当月支出<br>
      · 在投本金 = 累计买入 − 累计赎回（全部历史）
    </div>
  </div>

  <div class="card">
    <h3>危险操作</h3>
    <button class="btn danger" @click="confirmClear" :disabled="busy || !ready || !records.length">清空全部记账数据</button>
  </div>
</div>
`,
};
