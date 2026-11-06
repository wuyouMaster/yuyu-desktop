const { test } = require('node:test')
const assert = require('node:assert/strict')
const { verifyFfmpegLicense } = require('../../scripts/check-ffmpeg-license.cjs')

const result = (stdout, stderr = '') => () => ({ status: 0, stdout, stderr })
test('accepts a redistributable synthetic FFmpeg license report', () => {
  assert.doesNotThrow(() => verifyFfmpegLicense('fixture', result('ffmpeg is free software', '--disable-nonfree')))
})
test('rejects nonfree configuration even when it claims to be free', () => {
  assert.throws(() => verifyFfmpegLicense('fixture', result('ffmpeg is free software', 'configuration: --enable-nonfree --enable-gpl')), /nonfree/)
  assert.throws(() => verifyFfmpegLicense('fixture', result('This version of ffmpeg has nonfree parts compiled in.')), /nonfree/)
})
test('fails closed for errors, timeouts, and unrecognized license reports', () => {
  for (const fake of [() => ({ status: 1 }), () => ({ status: 0, stdout: 'unexpected' }), () => ({ error: new Error('timeout') })])
    assert.throws(() => verifyFfmpegLicense('fixture', fake), /Unable to verify/)
})
