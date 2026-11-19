import crypto from 'crypto'
import { prisma } from './prisma'
import { hashPassword, verifyPassword } from './auth'

/**
 * Ensure an admin user exists on boot.
 * - If ADMIN_PASSWORD is set, the admin password is synced to it. When the
 *   password actually changes, every admin session is invalidated.
 * - If ADMIN_PASSWORD is empty and no admin exists, a random password is
 *   generated, hashed and logged once. It is never hardcoded.
 * - If an admin already exists and ADMIN_PASSWORD is empty, nothing changes.
 */
export async function ensureAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL || 'admin@memebattle.local'
  const envPassword = process.env.ADMIN_PASSWORD ?? ''
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } })

  if (!admin) {
    const generated = envPassword.length === 0
    const password = generated ? crypto.randomBytes(12).toString('base64url') : envPassword
    const { hash, salt } = hashPassword(password)

    await prisma.user.create({
      data: { email, role: 'admin', passwordHash: hash, salt },
    })

    if (generated) {
      // The only secret we ever log: it is shown exactly once, on first boot,
      // because there is no other way to obtain the initial admin password.
      console.warn('==========================================================')
      console.warn(' Meme Battle admin created with a GENERATED password.')
      console.warn(' This password is shown only once and is not stored in plain text.')
      console.warn(`   email:    ${email}`)
      console.warn(`   password: ${password}`)
      console.warn(' Set ADMIN_PASSWORD to use a fixed password instead.')
      console.warn('==========================================================')
    } else {
      console.log(`Admin created: ${email} (password from ADMIN_PASSWORD)`)
    }
    return
  }

  // No ADMIN_PASSWORD configured: keep the existing admin untouched.
  if (envPassword.length === 0) return

  const unchanged =
    !!admin.passwordHash && !!admin.salt
      ? await verifyPassword(envPassword, admin.salt, admin.passwordHash)
      : false
  if (unchanged) return

  const { hash, salt } = hashPassword(envPassword)
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: hash, salt } })
  // A password change must not leave old (possibly leaked) sessions usable.
  await prisma.adminSession.deleteMany({})
  console.log(`Admin password for ${email} updated from ADMIN_PASSWORD; all sessions invalidated.`)
}
