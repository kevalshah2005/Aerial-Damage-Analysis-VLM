pipeline {
    agent any

    environment {
        NODE_ENV = 'production'
        APP_NAME = 'aerial-damage-analysis'
        APP_PORT = '3000'
    }

    stages {

        stage('Install Dependencies') {
            steps {
                echo 'Installing Node dependencies...'
                sh 'npm install --legacy-peer-deps'
            }
        }

        stage('Write Environment File') {
            steps {
                echo 'Writing .env.local...'
                withCredentials([
                    string(credentialsId: 'openai-api-key',        variable: 'OPENAI_KEY'),
                    string(credentialsId: 'cognito-user-pool-id',   variable: 'COGNITO_POOL_ID'),
                    string(credentialsId: 'cognito-client-id',      variable: 'COGNITO_CLIENT_ID'),
                    string(credentialsId: 'cognito-region',         variable: 'COGNITO_REGION')
                ]) {
                    sh '''
                        cat > .env.local <<EOF
OPENAI_API_KEY=${OPENAI_KEY}
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
                sh 'npm run build'
            }
        }

        stage('Deploy') {
            steps {
                echo 'Deploying with pm2...'
                sh '''
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
