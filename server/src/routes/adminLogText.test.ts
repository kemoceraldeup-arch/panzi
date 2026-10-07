import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAdminRequest, describeAiRequest, modelName } from './adminLogText';

test('page views read as sentences, with their filters', () => {
  assert.equal(describeAdminRequest('GET', '/api/admin/dashboard?range=30d', 200, null), 'Viewed the dashboard (last 30 days)');
  assert.equal(describeAdminRequest('GET', '/api/admin/dashboard?range=30d', 304, null), 'Viewed the dashboard (last 30 days)');
  assert.equal(describeAdminRequest('GET', '/api/admin/feedback?status=open', 200, null), 'Viewed feedback (open messages)');
  assert.equal(describeAdminRequest('GET', '/api/admin/logs?page=2&range=all&level=All', 200, null), 'Viewed system logs (page 2)');
  assert.equal(describeAdminRequest('GET', '/api/admin/users?q=maria', 200, null), 'Viewed the user list (searched “maria”)');
});

test('requests about one person name them', () => {
  assert.equal(describeAdminRequest('GET', '/api/admin/users/abc/pantry', 200, 'Maria'), "Looked at Maria's pantry");
  assert.equal(describeAdminRequest('GET', '/api/admin/users/abc/activity', 200, 'James'), "Looked at James' activity");
  assert.equal(describeAdminRequest('GET', '/api/admin/users/abc', 200, null), 'Opened an account');
  assert.equal(describeAdminRequest('PATCH', '/api/admin/review/feedback/abc', 200, 'Maria'), 'Updated a feedback message');
});

test('failures say so first', () => {
  assert.equal(describeAdminRequest('GET', '/api/admin/costs?range=7d', 403, null), 'Access denied: viewed API costs (last 7 days)');
  assert.equal(describeAdminRequest('GET', '/api/admin/alerts', 500, null), 'Failed: checked AI alerts');
});

test('AI calls read as the feature they served', () => {
  assert.equal(describeAiRequest('scan', true), 'Scanned groceries');
  assert.equal(describeAiRequest('recipes.browse', false), 'Failed: suggested recipes to browse');
  assert.equal(describeAiRequest('something-new', true), 'Used AI for something-new');
  assert.equal(modelName('claude-opus-5'), 'Claude Opus 5');
  assert.equal(modelName('claude-sonnet-4-5-20250929'), 'Claude Sonnet 4.5');
});
