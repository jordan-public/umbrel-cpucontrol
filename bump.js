const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
if (!newVersion) {
    console.error("Please provide a new version. Usage: node bump.js <version>");
    process.exit(1);
}

// Update cpucontrol/package.json
const pkgPath = path.join(__dirname, 'cpucontrol', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Updated package.json`);

// Update cpucontrol/package-lock.json (if exists)
const lockPath = path.join(__dirname, 'cpucontrol', 'package-lock.json');
if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.version = newVersion;
    if (lock.packages && lock.packages['']) {
        lock.packages[''].version = newVersion;
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Updated package-lock.json`);
}

// Update cpucontrol/umbrel-app.yml
const appYmlPath = path.join(__dirname, 'cpucontrol', 'umbrel-app.yml');
let appYml = fs.readFileSync(appYmlPath, 'utf8');
appYml = appYml.replace(/version:\s*".*"/, `version: "${newVersion}"`);
fs.writeFileSync(appYmlPath, appYml);
console.log(`Updated umbrel-app.yml`);

// Update cpucontrol/docker-compose.yml
const dcPath = path.join(__dirname, 'cpucontrol', 'docker-compose.yml');
let dc = fs.readFileSync(dcPath, 'utf8');
dc = dc.replace(/cpucontrol:[0-9]+\.[0-9]+\.[0-9]+/g, `cpucontrol:${newVersion}`);
fs.writeFileSync(dcPath, dc);
console.log(`Updated docker-compose.yml`);

// Update DEPLOY.md
const deployPath = path.join(__dirname, 'DEPLOY.md');
let deploy = fs.readFileSync(deployPath, 'utf8');
deploy = deploy.replace(/cpucontrol:[0-9]+\.[0-9]+\.[0-9]+/g, `cpucontrol:${newVersion}`);
deploy = deploy.replace(/version tag `[0-9]+\.[0-9]+\.[0-9]+`/g, `version tag \`${newVersion}\``);
fs.writeFileSync(deployPath, deploy);
console.log(`Updated DEPLOY.md`);

console.log(`\nSuccessfully bumped all version references to ${newVersion}`);
