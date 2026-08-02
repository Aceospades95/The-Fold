import type { FastifyInstance } from 'fastify'

export function sessionCookie(setCookie: string | string[] | undefined): { fold_session: string } {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie
  const match = /fold_session=([^;]+)/.exec(header ?? '')
  if (!match) throw new Error('no session cookie')
  return { fold_session: match[1] }
}

export async function signup(
  app: FastifyInstance,
  input: { name: string; email: string; password?: string; invite_code?: string },
): Promise<{ cookie: { fold_session: string }; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/signup',
    payload: { password: 'secret1', ...input },
  })
  if (res.statusCode !== 200) throw new Error(`signup failed: ${res.body}`)
  return { cookie: sessionCookie(res.headers['set-cookie']), userId: res.json().user.id }
}

/** Two linked members in one household: A signs up, invites, B joins with the code. */
export async function createLinkedHousehold(
  app: FastifyInstance,
  names: [string, string] = ['Jake', 'Sam'],
  domain = 'test.dev',
): Promise<{ cookie: { fold_session: string }; cookieB: { fold_session: string }; aId: string; bId: string }> {
  const a = await signup(app, { name: names[0], email: `${names[0].toLowerCase()}@${domain}` })
  const invite = (await app.inject({ method: 'POST', url: '/api/invites', cookies: a.cookie })).json()
  const b = await signup(app, {
    name: names[1],
    email: `${names[1].toLowerCase()}@${domain}`,
    invite_code: invite.code,
  })
  return { cookie: a.cookie, cookieB: b.cookie, aId: a.userId, bId: b.userId }
}
