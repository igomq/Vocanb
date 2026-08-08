import jetbrains.buildServer.configs.kotlin.*
import jetbrains.buildServer.configs.kotlin.buildSteps.script
import jetbrains.buildServer.configs.kotlin.triggers.vcs

version = "2024.03"

project {
    buildType(VocanbBuildDeploy)
}

object VocanbBuildDeploy : BuildType({
    name = "Vocanb build and deploy"

    artifactRules = "vocanb-%build.number%.tgz"

    vcs {
        root(DslContext.settingsRoot)
        cleanCheckout = true
        branchFilter = "+:refs/heads/main"
    }

    params {
        param("env.SERVICE_HOST", "10.255.255.254")
        param("env.SERVICE_SSH_USER", "%service.ssh.user%")
        param("env.SERVICE_SSH_KEY_PATH", "%service.ssh.key.path%")
    }

    steps {
        script {
            name = "Check, test, and build"
            scriptContent = """
                corepack enable
                corepack prepare pnpm@10.33.0 --activate
                pnpm install --frozen-lockfile
                pnpm check
                pnpm test
                pnpm build
            """.trimIndent()
            dockerImage = "node:24-bookworm-slim"
        }
        script {
            name = "Package release"
            scriptContent = "tar -czf vocanb-%build.number%.tgz build package.json pnpm-lock.yaml pnpm-workspace.yaml"
        }
        script {
            name = "Deploy through WireGuard"
            scriptContent = """
                scp -i "%env.SERVICE_SSH_KEY_PATH%" -o BatchMode=yes -o StrictHostKeyChecking=accept-new vocanb-%build.number%.tgz "%env.SERVICE_SSH_USER%@%env.SERVICE_HOST%:/tmp/vocanb-%build.number%.tgz"
                ssh -i "%env.SERVICE_SSH_KEY_PATH%" -o BatchMode=yes "%env.SERVICE_SSH_USER%@%env.SERVICE_HOST%" "sudo /usr/local/sbin/vocanb-release /tmp/vocanb-%build.number%.tgz %build.number%"
            """.trimIndent()
        }
    }

    triggers {
        vcs {
            branchFilter = "+:refs/heads/main"
        }
    }

    requirements {
        equals("teamcity.agent.jvm.os.name", "Linux")
    }
})
