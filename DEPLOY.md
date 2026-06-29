# Developer Deployment Notes

**Note:** This file is intended for developers maintaining the Umbrel CPU Control app. It is not intended for end users.

## Automated Deployment (Recommended)

To simplify releasing new versions, an automated deployment script is provided at the root of the repository (`deploy.sh`). This script uses the included `bump.js` tool to unify the version bump across all files and then builds and pushes the Docker image automatically.

1. **Ensure Docker Desktop is running** and you are logged into Docker Hub:
   ```bash
   docker login
   ```

2. **Set up a multi-architecture builder** (if you haven't already):
   ```bash
   docker buildx create --use
   ```

3. **Run the deployment script** with your target version:
   ```bash
   ./deploy.sh 1.0.18
   ```
   *This single command will:*
   * *Update `package.json` and `package-lock.json`.*
   * *Update `umbrel-app.yml` (App Store manifest).*
   * *Update `docker-compose.yml` image tags.*
   * *Update all version references in `DEPLOY.md`.*
   * *Build and push the multi-architecture image to Docker Hub under `jordanst/cpucontrol:1.0.18` and `jordanst/cpucontrol:latest`.*

4. **Commit and push** your changes to the community app store repository:
   ```bash
   git add .
   git commit -m "Release 1.0.18"
   git push
   ```

## Manual Version Bumping

If you only want to bump the versions across all configuration files without deploying to Docker Hub, you can run the bump script directly:

```bash
node bump.js 1.0.18
```
