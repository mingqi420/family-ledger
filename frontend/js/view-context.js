// 每个根应用提供独立上下文；组件显式声明依赖，并保留原始 ref 的响应性。
const LedgerContext = {
  key: Symbol('family-ledger'),
  use(keys) {
    const state = Vue.inject(LedgerContext.key);
    if (!state) throw new Error('页面组件必须挂载在账本应用内');
    return Object.fromEntries(keys.map(key => {
      if (!Object.prototype.hasOwnProperty.call(state, key)) {
        throw new Error('缺少页面绑定：' + key);
      }
      return [key, state[key]];
    }));
  },
};
