import { handle } from '../../server/api.mjs';

export async function onRequest(context) {
  return handle(context.request, context.env);
}
