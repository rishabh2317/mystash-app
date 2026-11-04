import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Response } from 'express';
import { CartServiceError } from './CartService';
import { sendCartRouteError } from './routes';

it('hides unexpected cart errors and preserves known business errors', () => {
  const captured = { status: 200, body: null as unknown };
  const response = {
    status(value: number) { captured.status = value; return this; },
    json(value: unknown) { captured.body = value; return this; },
  } as unknown as Response;
  sendCartRouteError(response, new Error('PRIVATE_DATABASE_CANARY'), 'list');
  assert.equal(captured.status, 500);
  assert.equal(JSON.stringify(captured.body).includes('PRIVATE_DATABASE_CANARY'), false);
  sendCartRouteError(response, new CartServiceError('Product not found', 404), 'add');
  assert.equal(captured.status, 404);
  assert.deepEqual(captured.body, { error: 'Product not found' });
});
