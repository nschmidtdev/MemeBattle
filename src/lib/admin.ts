import crypto from 'crypto'
import { prisma } from './prisma'
import { hashPassword } from './auth'

/**
 * Ensure an admin user exists on boot.
 * - If ADMIN_PASSWORD is set, the admin password is (re)synced to it.
 * - Otherwise, if the admin does not exist, a random password is generated and logged once.
 */
export async function ensureAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL || 'admin@memebattle.local'
  let admin = await prisma.user.findFirst({ where: { role: 'admin' } })

  if (!admin) {
    let password = process.env.ADMIN_PASSWORD
    if (!password) {
      password = crypto.randomBytes(12).toString('base64url')
    }
    const { hash, salt } = hashPassword(password)
    admin = await prisma.user.create({
      data: { email, role: 'admin', passwordHash: hash, salt },
    })
    console.log('==========================================================')
    if (!process.env.ADMIN_PASSWORD) {
      console.log(` Admin created with GENERATED password (shown only once):`)
      console.log(`   email:    ${email}`)
      console.log(`   password: ${password}`)
      console.log('==========================================================')
    } else {
      console.log(` Admin created: ${email} (password from ADMIN_PASSWORD)`)
      console.log('==========================================================')
    }
  } else if (process.env.ADMIN_PASSWORD) {
    const { hash, salt } = hashPassword(process.env.ADMIN_PASSWORD)
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: hash, salt } })
  }
}
