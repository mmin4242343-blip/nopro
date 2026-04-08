import { cors, clearTokenCookie, options } from './_shared/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options(event);

  return {
    statusCode: 200,
    headers: { ...cors(event), 'Set-Cookie': clearTokenCookie(event) },
    body: JSON.stringify({ success: true })
  };
}
