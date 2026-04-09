pipeline {
    agent any

    environment {
        NODE_ENV = 'production'
        APP_NAME = 'aerial-damage-analysis'
        APP_PORT = '3000'
    }

    stages {

        stage('Install Node.js') {
            steps {
                echo 'Installing Node.js via nvm...'
                sh '''
                    export NVM_DIR="$HOME/.nvm"
                    if [ ! -d "$NVM_DIR" ]; then
                        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
                    fi
                    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
                    nvm install 20
                    nvm use 20
                    node --version
                    npm --version
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing Node dependencies...'
                sh '''
                    export NVM_DIR="$HOME/.nvm"
                    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
                    nvm use 20
                    npm install --legacy-peer-deps --include=dev
                '''
            }
        }

        stage('Write Environment File') {
            steps {
                echo 'Writing .env.local...'
                withCredentials([
                    string(credentialsId: 'cognito-user-pool-id', variable: 'COGNITO_POOL_ID'),
                    string(credentialsId: 'cognito-client-id',    variable: 'COGNITO_CLIENT_ID'),
                    string(credentialsId: 'cognito-region',       variable: 'COGNITO_REGION')
                ]) {
                    sh '''
                        cat > .env.local <<EOF
NEXT_PUBLIC_COGNITO_USER_POOL_ID=${COGNITO_POOL_ID}
NEXT_PUBLIC_COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}
NEXT_PUBLIC_COGNITO_REGION=${COGNITO_REGION}
EOF
                    '''
                }
            }
        }

        stage('Build') {
            steps {
                echo 'Building Next.js application...'
                sh '''
                    export NVM_DIR="$HOME/.nvm"
                    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
                    nvm use 20
                    NEXT_TELEMETRY_DISABLED=1 npx next build --no-lint
                '''
            }
        }

        stage('Deploy') {
            steps {
                echo 'Deploying with pm2...'
                sh '''
                    export NVM_DIR="$HOME/.nvm"
                    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
                    nvm use 20

                    # Install pm2 globally if not already installed
                    npm list -g pm2 || npm install -g pm2

                    # Restart if already running, otherwise start fresh
                    pm2 describe ${APP_NAME} > /dev/null 2>&1 \
                        && pm2 restart ${APP_NAME} \
                        || pm2 start npm --name ${APP_NAME} -- start

                    # Save pm2 process list so it survives reboots
                    pm2 save
                '''
            }
        }
    }

    post {
        success {
            echo "Deployment successful. App is running on port ${APP_PORT}."
        }
        failure {
            echo 'Pipeline failed. Check the logs above for details.'
        }
    }
}
