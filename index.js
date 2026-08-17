#!/usr/bin/env node
import { downloadTemplate } from 'giget'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, basename, posix } from 'path'
import { execSync } from 'child_process'

const targetDir = process.argv[2] || '.'

async function main() {
    const label = targetDir === '.' ? 'current directory' : `./${targetDir}`
    console.log(`Creating backend in ${label} ...`)

    await downloadTemplate('github:izynegallardo/ja-express', {
        dir: targetDir,
        force: true,
    })

    updatePackageJson()

    console.log('Done. Next steps:')
    console.log(`  cd ${targetDir}`)
    console.log('  npm install')
    console.log('  cp .env.example .env')
    console.log('  npm run migrate')
    console.log('  npm run dev')
}

function toPosix(p) {
    return p.replace(/\\/g, '/')
}

function normalizeGitUrl(remoteUrl) {
    // Matches git@<any-host-or-alias>:owner/repo.git (including custom SSH config aliases)
    const sshMatch = remoteUrl.match(/^git@[^:]+:([^/]+)\/(.+?)(\.git)?$/)
    if (sshMatch) {
        const [, owner, repo] = sshMatch
        return `https://github.com/${owner}/${repo}`
    }

    return remoteUrl.replace(/\.git$/, '')
}

// Walks up from absoluteDir to find an enclosing git repo (not just a .git
// folder in absoluteDir itself), then reports the remote and the path of
// absoluteDir relative to that repo's root.
function getGitInfo(absoluteDir) {
    const gitOpts = { cwd: absoluteDir, stdio: ['ignore', 'pipe', 'ignore'] }

    try {
        execSync('git rev-parse --is-inside-work-tree', gitOpts)
    } catch {
        return null
    }

    let remoteUrl
    try {
        remoteUrl = execSync('git remote get-url origin', gitOpts).toString().trim()
    } catch {
        return null
    }
    if (!remoteUrl) return null

    const repoRoot = toPosix(execSync('git rev-parse --show-toplevel', gitOpts).toString().trim())
    const targetPosix = toPosix(absoluteDir)
    const subPath = posix.relative(repoRoot, targetPosix)

    return {
        httpsUrl: normalizeGitUrl(remoteUrl),
        subPath: subPath === '.' ? '' : subPath,
    }
}

function updatePackageJson() {
    const absoluteTargetDir = resolve(targetDir)
    const pkgPath = resolve(absoluteTargetDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

    const projectName = targetDir === '.' ? 'ja-express' : basename(absoluteTargetDir)

    pkg.name = projectName
    pkg.author = ''
    pkg.license = ''

    const gitInfo = getGitInfo(absoluteTargetDir)

    if (gitInfo) {
        const { httpsUrl, subPath } = gitInfo
        pkg.repository = { type: 'git', url: `git+${httpsUrl}.git` }
        pkg.bugs = { url: `${httpsUrl}/issues` }
        pkg.homepage = `${httpsUrl}${subPath ? `/${subPath}` : ''}#readme`
    } else {
        delete pkg.repository
        delete pkg.bugs
        delete pkg.homepage
    }

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

main().catch((err) => {
    console.error('Failed to create project:', err.message)
    process.exit(1)
})
