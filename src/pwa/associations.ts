export function nativeAssociations(env: Record<string, string | undefined>) {
  const team = env.WALLFLOW_IOS_TEAM_ID?.trim()
  const bundleId = env.WALLFLOW_IOS_BUNDLE_ID?.trim()
  const applicationId = env.WALLFLOW_ANDROID_APPLICATION_ID?.trim()
  const fingerprints = env.WALLFLOW_ANDROID_SHA256_FINGERPRINTS?.trim().split(',').map((item) => item.trim().toUpperCase()).filter(Boolean) ?? []
  const identifier = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/

  if ((team || bundleId) && (!team || !/^[A-Z0-9]{10}$/.test(team) || !bundleId || !identifier.test(bundleId))) {
    throw new Error('Configure both the Apple team ID and the iOS app bundle ID for Universal Links.')
  }
  if ((applicationId || fingerprints.length) && (!applicationId || !identifier.test(applicationId) || !fingerprints.length
    || fingerprints.some((item) => !/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(item)))) {
    throw new Error('Configure the Android application ID and SHA-256 signing fingerprints for App Links.')
  }

  return {
    'apple-app-site-association': { applinks: { details: team && bundleId ? [{
      appIDs: [`${team}.${bundleId}`],
      components: [{ '/': '/capture/native/ios' }, { '/': '/auth/native/ios/callback' }],
    }] : [] } },
    'assetlinks.json': applicationId && fingerprints.length ? [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: applicationId, sha256_cert_fingerprints: [...new Set(fingerprints)] },
    }] : [],
  }
}
