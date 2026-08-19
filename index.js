#!/usr/bin/env node
import { downloadTemplate } from 'giget'
import {
    readFileSync,
    writeFileSync,
    existsSync,
    copyFileSync,
    mkdirSync,
    cpSync,
    rmSync,
    readdirSync,
} from 'fs'
import { resolve, basename, posix, relative } from 'path'
import { execSync } from 'child_process'
import { createInterface } from 'node:readline/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const targetDir = process.argv[2] || '.'

async function main() {
    const label = targetDir === '.' ? 'current directory' : `./${targetDir}`
    const absoluteTargetDir = resolve(targetDir)

    console.log(`Creating backend in ${label} ...`)

    const tempDir = resolve(tmpdir(), `create-ja-express-${randomUUID()}`)

    try {
        await downloadTemplate('github:izynegallardo/ja-express', {
            dir: tempDir,
            force: true,
        })

        const applied = await applyTemplate(tempDir, absoluteTargetDir)
        if (!applied) return
    } finally {
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    }

    updatePackageJson(absoluteTargetDir)

    const proceed = await promptYesNo('\nInstall dependencies and start the dev server now? (Y/n) ')

    console.log('\nDone. Next steps:')
    console.log(`  cd ${targetDir}`)
    console.log('  npm install')
    console.log('  cp .env.example .env')
    console.log('  npm run migrate')
    console.log('  npm run dev')

    if (!proceed) return

    console.log('\nSetting things up...\n')

    process.chdir(absoluteTargetDir)

    run('npm install')

    const envExample = resolve(absoluteTargetDir, '.env.example')
    const envFile = resolve(absoluteTargetDir, '.env')
    if (existsSync(envExample) && !existsSync(envFile)) {
        copyFileSync(envExample, envFile)
        console.log('Created .env from .env.example')
    }

    run('npm run migrate')

    console.log('\nStarting dev server (Ctrl+C to stop)...\n')
    runDev('npm run dev')
}

// Copies the downloaded template from tempDir into absoluteTargetDir. If any
// template file would overwrite something already there, lists the
// collisions and asks for confirmation (defaulting to No) before touching
// anything. Returns false if the copy was cancelled.
async function applyTemplate(tempDir, absoluteTargetDir) {
    mkdirSync(absoluteTargetDir, { recursive: true })

    const templateFiles = walkFiles(tempDir)
    const existingFiles = new Set(walkFiles(absoluteTargetDir))
    const collisions = templateFiles.filter((file) => existingFiles.has(file))

    if (collisions.length > 0) {
        console.log('\nThe following existing files would be overwritten:')
        for (const file of collisions) console.log(`  ${file}`)

        const overwrite = await promptYesNo('\nOverwrite these files? (y/N) ', false)
        if (!overwrite) {
            console.log('\nCancelled. No files were changed.')
            return false
        }
    }

    cpSync(tempDir, absoluteTargetDir, { recursive: true, force: true })
    return true
}

// Recursively lists files under dir as paths relative to dir, skipping .git
// and node_modules since neither should ever be part of a collision check.
function walkFiles(dir) {
    if (!existsSync(dir)) return []

    const results = []
    const stack = [dir]

    while (stack.length) {
        const current = stack.pop()
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue

            const full = resolve(current, entry.name)
            if (entry.isDirectory()) {
                stack.push(full)
            } else {
                results.push(toPosix(relative(dir, full)))
            }
        }
    }

    return results
}

function run(command) {
    execSync(command, { stdio: 'inherit' })
}

// Runs a long-lived dev server; a Ctrl+C exits via signal, which throws in
// execSync even though nothing actually went wrong, so that case is reported
// as a normal stop rather than a failure. Any other non-zero exit is a real
// error and gets reported as one.
function runDev(command) {
    try {
        execSync(command, { stdio: 'inherit' })
    } catch (err) {
        if (err.signal) {
            console.log('\nDev server stopped.')
        } else {
            console.error('\nDev server exited with an error.')
        }
    }
}

async function promptYesNo(question, defaultYes = true) {
    if (!process.stdin.isTTY) return false

    const rl = createInterface({ input: process.stdin, output: process.stdout })

    try {
        const answer = (await rl.question(question)).trim().toLowerCase()
        if (answer === '') return defaultYes
        return answer === 'y' || answer === 'yes'
    } catch {
        // Ctrl+C at the prompt rejects the pending question() instead of just
        // returning empty input. Treat that the same as declining.
        console.log('\n\nCancelled.')
        return false
    } finally {
        rl.close()
    }
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

function updatePackageJson(absoluteTargetDir) {
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
