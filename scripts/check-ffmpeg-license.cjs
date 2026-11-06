const { spawnSync } = require('node:child_process')

// Check the binary actually staged for packaging, not an npm license label.
function verifyFfmpegLicense(executable, run = spawnSync) {
  const result = run(executable, ['-hide_banner', '-L'], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (/(?:^|\s)--enable-nonfree(?:\s|$)/m.test(output) || /nonfree parts compiled in/i.test(output))
    throw new Error('FFmpeg includes nonfree components and cannot be packaged')
  if (result.error || result.status !== 0 || !/ffmpeg is free software/i.test(output))
    throw new Error('Unable to verify FFmpeg redistribution license')
}

module.exports = { verifyFfmpegLicense }
