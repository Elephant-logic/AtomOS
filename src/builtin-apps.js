'use strict';

function clone(value) { return structuredClone(value); }

const CALCULATOR = {
  title: 'Calculator',
  description: 'A reliable four-function calculator.',
  state: { expression: '' },
  components: [
    { id: 'display', type: 'display', bind: 'expression', label: 'Calculator' },
    { id: 'clear', type: 'button', label: 'C', variant: 'danger', event: 'clear' },
    { id: 'open', type: 'button', label: '(', variant: 'secondary', event: 'open' },
    { id: 'close', type: 'button', label: ')', variant: 'secondary', event: 'close' },
    { id: 'divide', type: 'button', label: '÷', variant: 'secondary', event: 'divide' },
    { id: 'seven', type: 'button', label: '7', event: 'seven' },
    { id: 'eight', type: 'button', label: '8', event: 'eight' },
    { id: 'nine', type: 'button', label: '9', event: 'nine' },
    { id: 'multiply', type: 'button', label: '×', variant: 'secondary', event: 'multiply' },
    { id: 'four', type: 'button', label: '4', event: 'four' },
    { id: 'five', type: 'button', label: '5', event: 'five' },
    { id: 'six', type: 'button', label: '6', event: 'six' },
    { id: 'minus', type: 'button', label: '−', variant: 'secondary', event: 'minus' },
    { id: 'one', type: 'button', label: '1', event: 'one' },
    { id: 'two', type: 'button', label: '2', event: 'two' },
    { id: 'three', type: 'button', label: '3', event: 'three' },
    { id: 'plus', type: 'button', label: '+', variant: 'secondary', event: 'plus' },
    { id: 'zero', type: 'button', label: '0', event: 'zero' },
    { id: 'decimal', type: 'button', label: '.', event: 'decimal' },
    { id: 'equals', type: 'button', label: '=', variant: 'primary', event: 'equals' }
  ],
  rules: [
    ['clear', 'clear'], ['open', 'append', '('], ['close', 'append', ')'], ['divide', 'append', '÷'],
    ['seven', 'append', '7'], ['eight', 'append', '8'], ['nine', 'append', '9'], ['multiply', 'append', '×'],
    ['four', 'append', '4'], ['five', 'append', '5'], ['six', 'append', '6'], ['minus', 'append', '−'],
    ['one', 'append', '1'], ['two', 'append', '2'], ['three', 'append', '3'], ['plus', 'append', '+'],
    ['zero', 'append', '0'], ['decimal', 'append', '.'], ['equals', 'calculate']
  ].map(([event, op, value]) => ({
    event,
    actions: [{ op, target: 'expression', ...(op === 'calculate' ? { from: 'expression' } : value === undefined ? {} : { value }) }]
  }))
};

function matchBuiltinApp(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (/\bcalculator\b/.test(text)) return { id: 'calculator', app: clone(CALCULATOR) };
  return null;
}

module.exports = { CALCULATOR, matchBuiltinApp };
