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
    }

    params {
        param("env.SERVICE_HOST", "10.0.0.77")
        param("env.SERVICE_SSH_USER", "rocky")
        param("env.SERVICE_SSH_KEY_PATH", "~/.ssh/oci.pem")
    }

    steps {
        script {
            name = "Check, test, and build"
            scriptContent = """
                docker run --rm \
                  --user "${'$'}(id -u):${'$'}(id -g)" \
                  --volumes-from teamcity-agent \
                  --env HOME=/tmp \
                  --env COREPACK_HOME=/tmp/corepack \
                  --workdir "%teamcity.build.checkoutDir%" \
                  node:24-bookworm-slim sh -lc '
                    corepack pnpm install --frozen-lockfile
                    corepack pnpm check
                    corepack pnpm test
                    corepack pnpm build
                  '
            """.trimIndent()
        }
        script {
            name = "Package release"
            scriptContent = "tar -czf vocanb-%build.number%.tgz build package.json pnpm-lock.yaml pnpm-workspace.yaml"
        }
        script {
            name = "Deploy over OCI VCN"
            scriptContent = """
                scp -i %env.SERVICE_SSH_KEY_PATH% -o BatchMode=yes -o StrictHostKeyChecking=accept-new vocanb-%build.number%.tgz "%env.SERVICE_SSH_USER%@%env.SERVICE_HOST%:/tmp/vocanb-%build.number%.tgz"
                ssh -i %env.SERVICE_SSH_KEY_PATH% -o BatchMode=yes "%env.SERVICE_SSH_USER%@%env.SERVICE_HOST%" "sudo /usr/local/sbin/vocanb-release /tmp/vocanb-%build.number%.tgz %build.number%"
            """.trimIndent()
        }
    }

    triggers {
        vcs {}
    }

    requirements {
        equals("teamcity.agent.jvm.os.name", "Linux")
    }
})
