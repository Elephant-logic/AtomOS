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

const COUNTER = {
  title: 'Counter',
  description: 'A reliable counter with increment, decrement and reset controls.',
  state: { count: 0 },
  components: [
    { id: 'count', type: 'display', bind: 'count', label: 'Current count' },
    { id: 'decrement', type: 'button', label: '−1', variant: 'secondary', event: 'decrement' },
    { id: 'increment', type: 'button', label: '+1', variant: 'primary', event: 'increment' },
    { id: 'reset', type: 'button', label: 'Reset', variant: 'danger', event: 'reset' }
  ],
  rules: [
    { event: 'decrement', actions: [{ op: 'decrement', target: 'count', value: 1 }] },
    { event: 'increment', actions: [{ op: 'increment', target: 'count', value: 1 }] },
    { event: 'reset', actions: [{ op: 'set', target: 'count', value: 0 }] }
  ]
};

const FORM = {
  title: 'Contact Form',
  description: 'A simple contact form with clear and submit confirmation.',
  state: { name: '', email: '', message: '', confirmation: '' },
  components: [
    { id: 'heading', type: 'heading', text: 'Contact us' },
    { id: 'name', type: 'input', bind: 'name', label: 'Name', inputType: 'text' },
    { id: 'email', type: 'input', bind: 'email', label: 'Email', inputType: 'email' },
    { id: 'message', type: 'input', bind: 'message', label: 'Message', inputType: 'text' },
    { id: 'confirmation', type: 'text', bind: 'confirmation' },
    { id: 'clear', type: 'button', label: 'Clear', variant: 'secondary', event: 'clear' },
    { id: 'submit', type: 'button', label: 'Submit', variant: 'primary', event: 'submit' }
  ],
  rules: [
    { event: 'clear', actions: [
      { op: 'clear', target: 'name' },
      { op: 'clear', target: 'email' },
      { op: 'clear', target: 'message' },
      { op: 'clear', target: 'confirmation' }
    ] },
    { event: 'submit', actions: [{ op: 'set', target: 'confirmation', value: 'Thank you — your message has been received.' }] }
  ]
};

const SIGNUP = {
  title: 'Signup Form',
  description: 'A frontend signup form with a confirmation message.',
  state: { name: '', email: '', confirmation: '' },
  components: [
    { id: 'heading', type: 'heading', text: 'Create your account' },
    { id: 'name', type: 'input', bind: 'name', label: 'Name', inputType: 'text' },
    { id: 'email', type: 'input', bind: 'email', label: 'Email', inputType: 'email' },
    { id: 'confirmation', type: 'text', bind: 'confirmation' },
    { id: 'clear', type: 'button', label: 'Clear', variant: 'secondary', event: 'clear' },
    { id: 'signup', type: 'button', label: 'Sign up', variant: 'primary', event: 'signup' }
  ],
  rules: [
    { event: 'clear', actions: [
      { op: 'clear', target: 'name' },
      { op: 'clear', target: 'email' },
      { op: 'clear', target: 'confirmation' }
    ] },
    { event: 'signup', actions: [{ op: 'set', target: 'confirmation', value: 'Thanks for signing up!' }] }
  ]
};

function matchBuiltinApp(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (/\bcalculator\b/.test(text)) return { id: 'calculator', app: clone(CALCULATOR) };
  if (/\bcounter\b|\bcounting app\b/.test(text)) return { id: 'counter', app: clone(COUNTER) };
  if (/\bsign[ -]?up\b|\bregistration form\b/.test(text) && !/\bbackend|database|authentication|accounts?\b/.test(text)) return { id: 'signup', app: clone(SIGNUP) };
  if (/\b(contact|feedback|simple) form\b|\bform with\b/.test(text)) return { id: 'form', app: clone(FORM) };
  return null;
}

module.exports = { CALCULATOR, COUNTER, FORM, SIGNUP, matchBuiltinApp };