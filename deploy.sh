#!/bin/bash

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./deploy.sh <new-version>"
  echo "Example: ./deploy.sh 1.0.29"
  exit 1
fi

echo "🚀 Bumping version to $VERSION across the project..."
node bump.js "$VERSION"

if [ $? -ne 0 ]; then
  echo "❌ Version bump failed. Aborting deployment."
  exit 1
fi

echo "🐳 Building and pushing Docker image to Docker Hub..."
cd jordan-cpucontrol || exit 1
docker buildx build --platform linux/amd64 -t jordanst/cpucontrol:"$VERSION" -t jordanst/cpucontrol:latest --push .

if [ $? -ne 0 ]; then
  echo "❌ Docker build/push failed."
  exit 1
fi

echo "✅ Successfully built and published version $VERSION!"
echo ""
echo "Next steps:"
echo "1. Commit your changes: git commit -am \"Release $VERSION\""
echo "2. Push to your repository: git push"
