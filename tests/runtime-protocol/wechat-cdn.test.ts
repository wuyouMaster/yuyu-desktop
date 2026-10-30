import { createCipheriv, createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { RuntimeRpcBridgeClient } from '../../src/main/runtime-rpc/bridge-client'
import { WechatCDNClient } from '../../src/main/runtime-rpc/wechat-cdn-client'
const executable = process.env.YUYU_TEST_WECHAT_HOST
if (!executable) throw new Error('YUYU_TEST_WECHAT_HOST is required')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
it('transfers a 9 MiB CDN payload through the actual worker and native cipher', async () => {
  const rpc = new RuntimeRpcBridgeClient(resolve('out/worker/main/runtime-rpc/bridge-worker.js'), {
    executable
  })
  try {
    const input = Buffer.alloc(9 * 1024 * 1024 + 13)
    for (let i = 0; i < input.length; i++) input[i] = (i * 13 + 17) % 251
    const key = Buffer.alloc(16, 7),
      cipher = createCipheriv('aes-128-cbc', key, key)
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()])
    const actual = await new WechatCDNClient(rpc).decrypt(encrypted, key.toString('hex'))
    expect(actual.equals(input)).toBe(true)
    expect(sha(actual)).toBe(sha(input))
    encrypted[encrypted.length - 1] ^= 1
    await expect(
      new WechatCDNClient(rpc).decrypt(encrypted, key.toString('hex'))
    ).rejects.toMatchObject({ code: 'AES_DECRYPT_FAILED' })
  } finally {
    await rpc.close()
  }
})
