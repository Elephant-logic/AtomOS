(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const style = document.createElement('style');
  style.textContent = `
    .app-component.board{grid-column:1/-1;display:grid;gap:6px}.board-cell{aspect-ratio:1;min-height:56px;font-size:24px;font-weight:800;background:#fff;color:#152238;border:1px solid #cbd7e7;border-radius:9px}
    .app-component.image{grid-column:1/-1;max-width:100%;border-radius:11px}.app-component.link{grid-column:1/-1;color:#2969e8;font-weight:700;text-decoration:none;padding:6px 0}
    .app-component.group{grid-column:1/-1;display:flex;flex-wrap:wrap}.app-component.group.column{flex-direction:column}.app-component.group.grid,.app-component.group.stack{display:grid}.app-component.group.stack>*{grid-area:1/1}
    .app-component.repeat{grid-column:1/-1;display:grid;gap:8px}.repeat-item{padding:10px;border:1px solid #cbd7e7;border-radius:9px;background:#fff;color:#152238}.repeat-item.card{min-height:72px}.repeat-item.image{width:100%;max-height:220px;object-fit:cover}
  `;
  document.head.appendChild(style);

  function visible(component) {
    if (component.visibleWhen && !state[component.visibleWhen]) return false;
    if (component.hiddenWhen && state[component.hiddenWhen]) return false;
    return true;
  }
  function disabled(component) {
    return Boolean((component.enabledWhen && !state[component.enabledWhen]) || (component.disabledWhen && state[component.disabledWhen]));
  }
  function itemLabel(component, item, index) {
    if (item && typeof item === 'object') return String(item[component.itemLabelField || 'label'] ?? item.name ?? item.title ?? index + 1);
    return String(item ?? '');
  }
  function findAtom(component) {
    return typeof atoms === 'function' ? atoms().find(atom => atom.id === component.id) : null;
  }

  window.component = function component(component, insideGroup = false) {
    let element;
    if (!visible(component)) { element = document.createElement('span'); element.hidden = true; return element; }
    if (component.type === 'heading' || component.type === 'text') {
      element = document.createElement('div'); element.className = `app-component ${component.type}`;
      element.textContent = component.bind ? String(state[component.bind] ?? '') : component.text || '';
    } else if (component.type === 'display') {
      element = document.createElement('div'); element.className = 'app-component display';
      element.textContent = String(state[component.bind] ?? component.text ?? '');
    } else if (component.type === 'input') {
      element = document.createElement('input'); element.className = 'app-component input';
      element.type = component.inputType || 'text'; element.placeholder = component.label || '';
      element.value = String(state[component.bind] ?? ''); element.disabled = disabled(component);
      element.oninput = () => { state[component.bind] = element.type === 'number' ? Number(element.value) : element.value; };
    } else if (component.type === 'button') {
      element = document.createElement('button'); element.className = `app-component button ${component.variant || 'primary'}`;
      element.textContent = component.label || component.text || component.id; element.disabled = disabled(component);
      element.onclick = () => runEvent(component.event);
    } else if (component.type === 'board') {
      element = document.createElement('div'); element.className = 'app-component board';
      const rows = Number(component.rows || 3), cols = Number(component.cols || 3);
      element.style.gridTemplateColumns = `repeat(${cols},1fr)`;
      const values = Array.isArray(state[component.bind]) ? state[component.bind] : [];
      for (let index = 0; index < rows * cols; index += 1) {
        const cell = document.createElement('button'); cell.className = 'board-cell'; cell.textContent = values[index] ?? '';
        cell.disabled = disabled(component);
        cell.onclick = event => { event.stopPropagation(); state[component.indexState] = index; runEvent(component.event); };
        element.appendChild(cell);
      }
    } else if (component.type === 'image') {
      element = document.createElement('img'); element.className = 'app-component image'; element.src = component.src; element.alt = component.alt || '';
    } else if (component.type === 'link') {
      element = document.createElement('a'); element.className = 'app-component link';
      element.textContent = component.label || component.text || component.href || component.toScreen;
      if (component.href) { element.href = component.href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
      else { element.href = '#'; element.onclick = event => { event.preventDefault(); event.stopPropagation(); navigateTo(component.toScreen); }; }
    } else if (component.type === 'group') {
      element = document.createElement('div'); element.className = `app-component group ${component.layout || 'row'}`;
      element.style.gap = `${Number(component.gap ?? 9)}px`;
      if (component.layout === 'grid') element.style.gridTemplateColumns = `repeat(${Number(component.columns || 2)},minmax(0,1fr))`;
      for (const id of component.children || []) {
        const child = currentApp.components.find(item => item.id === id);
        if (child) element.appendChild(window.component(child, true));
      }
    } else if (component.type === 'repeat') {
      element = document.createElement('div'); element.className = 'app-component repeat';
      element.style.gridTemplateColumns = `repeat(${Number(component.columns || 1)},minmax(0,1fr))`;
      const items = Array.isArray(state[component.bind]) ? state[component.bind] : [];
      items.forEach((item, index) => {
        let child;
        if (component.itemType === 'image') {
          child = document.createElement('img');
          child.src = item && typeof item === 'object' ? item[component.itemImageField || 'src'] : String(item || '');
          child.alt = itemLabel(component, item, index);
        } else {
          child = document.createElement(component.itemType === 'button' ? 'button' : 'div');
          child.textContent = itemLabel(component, item, index);
        }
        child.className = `repeat-item ${component.itemType || 'text'}`;
        if (component.itemEvent) child.onclick = event => { event.stopPropagation(); state[component.itemIndexState] = index; runEvent(component.itemEvent); };
        element.appendChild(child);
      });
    } else {
      element = document.createElement('div'); element.className = 'app-component';
    }
    if (insideGroup) element.style.gridColumn = 'auto';
    element.onclick = element.onclick || (() => select('atom', findAtom(component)));
    if (selection?.data?.source === component) element.classList.add('selected');
    return element;
  };

  window.appPreview = function appPreview() {
    const shell = document.createElement('div'); shell.className = 'app-shell';
    shell.innerHTML = `<h2>${currentApp.title}</h2><div class="app-desc">${currentApp.description || ''}</div>`;
    const grid = document.createElement('div'); grid.className = 'app-grid';
    const active = currentApp.activeScreen ? state[currentApp.activeScreen] : null;
    const grouped = new Set(currentApp.components.filter(item => item.type === 'group').flatMap(item => item.children || []));
    currentApp.components.filter(item => (!item.screen || item.screen === active) && !grouped.has(item.id)).forEach(item => grid.appendChild(window.component(item)));
    shell.appendChild(grid); return shell;
  };
})();
