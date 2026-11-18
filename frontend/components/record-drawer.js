// 记账抽屉：模板与组件绑定；账本数据由根应用统一管理。
const RecordDrawer = {
  name: 'RecordDrawer',
  setup() {
    const bindings = LedgerContext.use(['closeOverlay', 'busy', 'syncError', 'reloadData', 'form', 'expenseCats', 'incomeCats', 'members', 'today', 'cleanAmount', 'saveRecord', 'ready', 'switchType']);
    const amtInput = Vue.ref(null);
    const focusAmount = () => amtInput.value?.focus();
    Vue.onMounted(focusAmount);
    function switchType(type) {
      bindings.switchType(type);
      Vue.nextTick(focusAmount);
    }
    return { ...bindings, amtInput, switchType };
  },
  template: `
<div class="mask" @click="closeOverlay"></div>
<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
  <div class="grab"></div>
  <div class="drawer-head"><strong id="drawer-title">记一笔</strong><button @click="closeOverlay" :disabled="busy" aria-label="关闭记账窗口">✕</button></div>
  <div class="status-bar warning" v-if="syncError"><span class="message">{{ syncError }}</span><button @click="reloadData" :disabled="busy">重新加载账本</button></div>
  <fieldset class="drawer-fields" :disabled="busy">
  <div class="type-tabs">
    <button class="t-expense" :class="{on: form.type==='expense'}" @click="switchType('expense')">支出</button>
    <button class="t-income" :class="{on: form.type==='income'}" @click="switchType('income')">收入</button>
    <button class="t-invest" :class="{on: form.type==='invest'}" @click="switchType('invest')">理财</button>
    <button class="t-transfer" :class="{on: form.type==='transfer'}" @click="switchType('transfer')">内部转账</button>
  </div>

  <div class="amount-box">
    <span class="cur">¥</span>
    <input ref="amtInput" v-model="form.amount" type="text" inputmode="decimal" placeholder="0.00" aria-label="金额（元）" maxlength="12" @input="cleanAmount">
  </div>

  <!-- 支出 / 收入：分类 -->
  <div class="cat-grid" v-if="form.type==='expense' || form.type==='income'">
    <button v-for="c in (form.type==='expense' ? expenseCats : incomeCats)" :key="c.name"
            :class="{on: form.category===c.name}" @click="form.category=c.name">
      <span class="e">{{ c.emoji }}</span>{{ c.name }}
    </button>
  </div>

  <!-- 理财：动作 + 平台 -->
  <template v-if="form.type==='invest'">
    <div class="form-line">
      <span class="lbl">类型</span>
      <div class="action-seg">
        <button :class="{on: form.action==='buy'}" @click="form.action='buy'">买入</button>
        <button :class="{on: form.action==='redeem'}" @click="form.action='redeem'">赎回</button>
        <button :class="{on: form.action==='profit'}" @click="form.action='profit'">收益</button>
      </div>
    </div>
    <div class="form-line">
      <span class="lbl">平台</span>
      <input class="input" v-model="form.platform" placeholder="如：余额宝 / 招商银行 / 某基金" aria-label="理财平台" maxlength="64">
    </div>
    <div class="hint" v-if="form.action!=='profit'">买入/赎回仅记录本金流转，不计入收支账单</div>
    <div class="hint" v-else>收益会计入账单（+）</div>
  </template>

  <!-- 内部转账：转出 / 转入 -->
  <template v-if="form.type==='transfer'">
    <div class="form-line">
      <span class="lbl">转出人</span>
      <div class="member-seg">
        <button v-for="m in members" :key="'f'+m.id" :class="{on: form.from===m.id}" @click="form.from=m.id">{{ m.name }}</button>
      </div>
    </div>
    <div class="form-line">
      <span class="lbl">转入人</span>
      <div class="member-seg">
        <button v-for="m in members" :key="'t'+m.id" :class="{on: form.to===m.id}" @click="form.to=m.id">{{ m.name }}</button>
      </div>
    </div>
    <div class="hint">家庭内部转账不计入账单，仅做记录</div>
  </template>

  <!-- 成员（支出/收入） -->
  <div class="form-line" v-if="form.type==='expense' || form.type==='income'">
    <span class="lbl">成员</span>
    <div class="member-seg">
      <button v-for="m in members" :key="m.id" :class="{on: form.member===m.id}" @click="form.member=m.id">{{ m.name }}</button>
    </div>
  </div>

  <div class="form-line">
    <span class="lbl">日期</span>
    <input class="input" v-model="form.date" type="date" min="1000-01-01" :max="today" aria-label="记账日期">
  </div>
  <div class="form-line">
    <span class="lbl">备注</span>
    <input class="input" v-model="form.note" placeholder="选填" maxlength="500" aria-label="备注">
  </div>

  <button class="btn primary" @click="saveRecord" :disabled="busy || !ready">{{ busy ? '正在保存…' : '保存到数据库' }}</button>
  <button class="btn ghost" @click="closeOverlay" :disabled="busy">取消</button>
  </fieldset>
</div>
`,
};
