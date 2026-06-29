# Developer Deployment Notes

**Note:** This file is intended for developers maintaining the Umbrel CPU Control app. It is not intended for end users.

## Deploying to Docker Hub

To build and publish a new version of the Umbrel CPU Control app to Docker Hub, follow these steps:

1. **Ensure Docker Desktop is running** and you are logged into Docker Hub:
   ```bash
   docker login
   ```

2. **Set up a multi-architecture builder** (if you haven't already):
   ```bash
   docker buildx create --use
   ```

3. **Build and push the image**:
   Run the following command from the repository root:
   ```bash
   cd jordan-cpucontrol
   docker buildx build --platform linux/amd64,linux/arm64 -t jordanst/cpucontrol:1.0.3 -t jordanst/cpucontrol:latest --push .
   ```
   *(Update the version tag `1.0.3` as necessary when releasing new versions.)*

4. **Update `docker-compose.yml`**:
   Make sure `jordan-cpucontrol/docker-compose.yml` uses the correct updated image tag (e.g., `image: jordanst/cpucontrol:1.0.3`).

5. **Update App Metadata**:
   Ensure `jordan-cpucontrol/umbrel-app.yml` has the correct updated `version`.

6. **Commit and push** your changes to the community app store repository.