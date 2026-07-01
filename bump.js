const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
if (!newVersion) {
    console.error("Please provide a new version. Usage: node bump.js <version>");
    process.exit(1);
}

const appDir = 'jordan-cpucontrol';

// Update jordan-cpucontrol/package.json
const pkgPath = path.join(__dirname, appDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Updated package.json`);

// Update jordan-cpucontrol/package-lock.json (if exists)
const lockPath = path.join(__dirname, appDir, 'package-lock.json');
if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.version = newVersion;
    if (lock.packages && lock.packages['']) {
        lock.packages[''].version = newVersion;
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Updated package-lock.json`);
}

// Update jordan-cpucontrol/umbrel-app.yml
const appYmlPath = path.join(__dirname, appDir, 'umbrel-app.yml');
let appYml = fs.readFileSync(appYmlPath, 'utf8');
appYml = appYml.replace(/version:\s*".*"/, `version: "${newVersion}"`);
fs.writeFileSync(appYmlPath, appYml);
console.log(`Updated umbrel-app.yml`);

// Update jordan-cpucontrol/docker-compose.yml
const dcPath = path.join(__dirname, appDir, 'docker-compose.yml');
let dc = fs.readFileSync(dcPath, 'utf8');
dc = dc.replace(/cpucontrol:[0-9]+\.[0-9]+\.[0-9]+/g, `cpucontrol:${newVersion}`);
fs.writeFileSync(dcPath, dc);
console.log(`Updated docker-compose.yml`);

// Update DEPLOY.md
const deployPath = path.join(__dirname, 'DEPLOY.md');
let deploy = fs.readFileSync(deployPath, 'utf8');
deploy = deploy.replace(/cpucontrol:[0-9]+\.[0-9]+\.[0-9]+/g, `cpucontrol:${newVersion}`);
deploy = deploy.replace(/\.\/deploy\.sh [0-9]+\.[0-9]+\.[0-9]+/g, `./deploy.sh ${newVersion}`);
deploy = deploy.replace(/Release [0-9]+\.[0-9]+\.[0-9]+/g, `Release ${newVersion}`);
deploy = deploy.replace(/node bump\.js [0-9]+\.[0-9]+\.[0-9]+/g, `node bump.js ${newVersion}`);
deploy = deploy.replace(/version tag `[0-9]+\.[0-9]+\.[0-9]+`/g, `version tag \`${newVersion}\``);
fs.writeFileSync(deployPath, deploy);
console.log(`Updated DEPLOY.md`);

// Update README.md API version example
const readmePath = path.join(__dirname, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');
readme = readme.replace(/"version":\s*"[0-9]+\.[0-9]+\.[0-9]+"/, `"version": "${newVersion}"`);
fs.writeFileSync(readmePath, readme);
console.log(`Updated README.md`);

console.log(`\nSuccessfully bumped all version references to ${newVersion}`);
