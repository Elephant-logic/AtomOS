'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COUNTER, FORM, SIGNUP, matchBuiltinApp } = require('../src/builtin-apps');
const { normalizeApplication, validateReferences } = require('../src/app-platform');
const runtime = require('../public/runtime-core');

function validated(app) {
  const copy = normalizeApplication(structuredClone(app));
  assert.doesNotThrow(() => validateReferences(copy));
  return copy;
}

test('counter prompts use a validated deterministic builtin', () => {
  const match = matchBuiltinApp('Build a counter with add one, subtract one and reset.');
  assert.equal(match.id, 'counter');
  const app = validated(COUNTER);
  const state = structuredClone(app.state);
  runtime.executeEvent(app, state, 'increment');
  runtime.executeEvent(app, state, 'increment');
  runtime.executeEvent(app, state, 'decrement');
  assert.equal(state.count, 1);
  runtime.executeEvent(app, state, 'reset');
  assert.equal(state.count, 0);
});

test('simple form and signup prompts use validated deterministic builtins', () => {
  assert.equal(matchBuiltinApp('Build a contact form with name and email.').id, 'form');
  assert.equal(matchBuiltinApp('Build a signup form with name, email and thank-you message.').id, 'signup');
  const form = validated(FORM);
  const formState = structuredClone(form.state);
  runtime.executeEvent(form, formState, 'submit');
  assert.match(formState.confirmation, /thank you/i);
  const signup = validated(SIGNUP);
  const signupState = structuredClone(signup.state);
  runtime.executeEvent(signup, signupState, 'signup');
  assert.match(signupState.confirmation, /signing up/i);
});

test('backend signup requests are not replaced by the frontend builtin', () => {
  assert.equal(matchBuiltinApp('Build a signup form with a database and authentication'), null);
});
