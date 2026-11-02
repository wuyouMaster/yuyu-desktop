import path from 'path'

export const CURRENT_USER_DATA_NAME = 'YUYU'
export const YUYU_RUNTIME_NAME = '语屿 YUYU'

export interface UserDataRoots {
  current: string
}

export interface UserDataSelectionInput extends UserDataRoots {
  isolated?: string
}

export function getUserDataRoots(appDataPath: string): UserDataRoots {
  return {
    current: path.join(appDataPath, CURRENT_USER_DATA_NAME)
  }
}

export function chooseUserDataRoot(input: UserDataSelectionInput): string {
  const isolated = input.isolated?.trim()
  return isolated ? path.resolve(isolated) : input.current
}
