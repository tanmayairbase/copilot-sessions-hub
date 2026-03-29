import { isAbsolute, relative, resolve } from 'node:path'

export const isWithinRepoRoot = (candidate: string, root: string): boolean => {
  const relativePath = relative(resolve(root), resolve(candidate))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

export const isWithinRepoRoots = (candidate: string, roots: string[]): boolean => {
  return roots.some(root => isWithinRepoRoot(candidate, root))
}
