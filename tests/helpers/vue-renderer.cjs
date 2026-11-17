// 轻量内存宿主：实际执行 Vue 模板、组件生命周期和事件绑定，不依赖第三方 DOM 库。
// 仅模拟本项目用到的 DOM 行为；视觉、浏览器默认行为仍由真实浏览器验证。
module.exports = function createTestRenderer(Vue, document) {
  function all(node, predicate) {
    return [node, ...node.children.flatMap(child => all(child, () => true))].filter(predicate);
  }
  const hasClass = (node, name) => String(node.props.class || '').split(/\s+/).includes(name);
  const inside = (node, name) => {
    for (let parent = node.parentNode; parent; parent = parent.parentNode) {
      if (hasClass(parent, name)) return true;
    }
    return false;
  };
  function makeNode(type, text = '') {
    return Vue.markRaw({
      type, tagName: type.toUpperCase(), nodeType: type === '#text' ? 3 : type === '#comment' ? 8 : 1,
      text, props: {}, style: {}, children: [], parentNode: null, listeners: {}, value: '', clicks: 0,
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
      removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(item => item !== fn); },
      dispatchEvent(event) {
        event.target ||= this;
        event.currentTarget = this;
        event.preventDefault ||= () => {};
        event.stopPropagation ||= () => {};
        for (const fn of this.listeners[event.type] || []) fn(event);
        const handler = this.props['on' + event.type[0].toUpperCase() + event.type.slice(1)];
        if (Array.isArray(handler)) handler.forEach(fn => fn(event));
        else if (handler) handler(event);
      },
      click() { this.clicks++; this.dispatchEvent({ type: 'click' }); },
      focus() { document.activeElement = this; },
      querySelectorAll(selector) {
        if (selector !== 'button:not(:disabled), input:not(:disabled), [tabindex="0"]') {
          throw new Error('测试宿主不支持选择器：' + selector);
        }
        return all(this, node => (node.type === 'button' || node.type === 'input' || node.props.tabindex === '0') && !node.props.disabled);
      },
    });
  }
  function remove(node) {
    if (!node.parentNode) return;
    const siblings = node.parentNode.children;
    siblings.splice(siblings.indexOf(node), 1);
    node.parentNode = null;
  }
  const renderer = Vue.createRenderer({
    createElement: makeNode,
    createText: text => makeNode('#text', text),
    createComment: text => makeNode('#comment', text),
    insert(node, parent, anchor = null) {
      remove(node);
      const index = anchor ? parent.children.indexOf(anchor) : parent.children.length;
      if (index < 0) throw new Error('无效的插入锚点');
      parent.children.splice(index, 0, node);
      node.parentNode = parent;
    },
    remove,
    setElementText(node, text) {
      node.children.forEach(child => { child.parentNode = null; });
      node.children = [];
      node.text = text;
    },
    setText(node, text) { node.text = text; },
    parentNode: node => node.parentNode,
    nextSibling: node => node.parentNode?.children[node.parentNode.children.indexOf(node) + 1] || null,
    patchProp(node, key, previous, value) {
      node.props[key] = value;
      if (key === 'value') node.value = value ?? '';
    },
  });
  const root = makeNode('root');
  document.createEvent = () => ({ initEvent(type) { this.type = type; } });
  document.querySelector = selector => {
    if (selector === '.modal .cancel, .drawer input') {
      return all(root, node => (hasClass(node, 'cancel') && inside(node, 'modal')) || (node.type === 'input' && inside(node, 'drawer')))[0] || null;
    }
    if (selector === '.modal' || selector === '.drawer') return all(root, node => hasClass(node, selector.slice(1)))[0] || null;
    throw new Error('测试宿主不支持选择器：' + selector);
  };
  return {
    root, renderer, hasClass,
    all: predicate => all(root, predicate),
    text(node = root) { return (node.type === '#comment' ? '' : node.text) + node.children.map(child => this.text(child)).join(''); },
  };
};
