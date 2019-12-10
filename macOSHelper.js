/**
 * @file macOSHelper.js
 * Entry point of this application.
 *
 * This application is created to simplify testing ArangoDB on a macOS based system.
 * You need ArangoDB in their `tar.gz` packages to be tested. If you also want to be
 * able to execute upgrade tests, you need both packages (e.g. 3.5.3 and 3.6.0).
 */

const program = require('commander');
const inquirer = require('inquirer');
const targz = require('targz');
const fs = require('fs');
const { readdirSync } = require('fs');
const { join } = require('path');
const rimraf = require("rimraf");
const { exec } = require('child_process');
const util = require('util');

const spawn = require('child_process').spawn;

const arangoPackageLocation = './arangodb/';
const tmpDirectory = './tmp/';
const tmpNewDirectory = './tmp/new/';
const tmpOldDirectory = './tmp/old/';
const tmpDatabaseDirectory = './tmp/databaseDirectory/';

const listOfOptions = [
  'singleServer'
];

function sleep(ms){
  return new Promise(resolve=>{
    setTimeout(resolve,ms)
  })
}

// commander options
program
  .version('1.0.0', '-v, --vers', 'output the current version')
  .arguments('<cmd> [env]')
  .option('-k, --keep <bool>', 'Keep the tmp directory and skip decrompressing the tar.gz files.')
  .option('-f, --force <bool>', 'Do you want to force test execution? This will killall arangodb and arangod instances.')
  .option('-d, --debug <bool>', 'If debug is set to true, more output will be generated.')
  .action(function (cmd, env) {
    cmdValue = cmd;
    envValue = env;
  });
program.parse(process.argv);

if (program.debug) {
  if (program.debug === 'false') {
    program.debug = false;
  }
}

if (typeof cmdValue === 'undefined') {
  console.error('No command given!');
  process.exit(1);
} else {
  if (listOfOptions.indexOf(cmdValue) === -1) {
    console.error('Invalid command given!');
    process.exit(1);
  }
}
console.log('command:', cmdValue);
console.log('environment:', envValue || "no environment given");

// states
let testUpgrade = false;

// required parameters
let configuration = {
  oldArangoDB: null, // path to the older `tar.gz` version of ArangoDB
  newArangoDB: null,  // path to the newer `tar.gz` version of ArangoDB
  tmpNewSubDirectory: null,
  tmpOldSubDirectory: null,
  tmpNewStarter: null,
  tmpNewArangod: null,
  tmpNewJS: null,
  tmpOldStarter: null,
  tmpOldArangod: null,
  tmpOldJS: null
}

fs.readdir(arangoPackageLocation, (err, files) => {
  let packages = [];
  files.forEach(file => {
    packages.push(file);
  });
  packages = packages.reverse(); // TODO can be removed later

  if (packages.length === 0) {
    console.log('No macOS packages found in: ' + arangoPackageLocation + ' - exiting.');
    return;
  } else if (packages.length === 1) {
    configuration.newArangoDB = packages[0];
    console.log('Selected ' + configuration.newArangoDB + ' as the version to use.');
  } else if (packages.length === 2) {
    inquirer.prompt([
        {
          type: 'list',
          name: 'newArangoDB',
          choices: packages,
          message: 'Choose the newer version of ArangoDB.'
        }
      ])
      .then(answer => {
        console.log('Selected ' + answer.newArangoDB + ' as the never version.');
        configuration.newArangoDB = answer.newArangoDB;
        if (packages.indexOf(answer.newArangoDB) === 0) {
          configuration.oldArangoDB = packages[1];
        } else {
          configuration.oldArangoDB = packages[0];
        }

        testUpgrade = true;
        startDecrompress();
      });
  } else {
    console.log('Found more then two files/packages in: ' + arangoPackageLocation + ' - Not supported. Exiting.');
    return;
  }
});

function startDecrompress() {
  if (!program.keep) {
    // create tmp directories
    if (fs.existsSync(tmpDirectory)) {
      rimraf.sync(tmpDirectory); // will delete the directory including all files and subdirectories there
    }
    fs.mkdirSync(tmpDirectory);
    if (!fs.existsSync(tmpNewDirectory)) {fs.mkdirSync(tmpNewDirectory);}
    if (!fs.existsSync(tmpOldDirectory)) {fs.mkdirSync(tmpOldDirectory);}
    if (!fs.existsSync(tmpDatabaseDirectory)) {fs.mkdirSync(tmpDatabaseDirectory);}

    // now decompress all the files in their tmp directories
    if (testUpgrade) {
      targz.decompress({
        src: arangoPackageLocation + configuration.oldArangoDB,
        dest: tmpOldDirectory
      }, function(err) {
        if (err) {
          console.log("Not able to decompress: " + err);
          process.exit(1);
        }
      });
    }
    targz.decompress({
      src: arangoPackageLocation + configuration.newArangoDB,
      dest: tmpNewDirectory
    }, function(err) {
      if (err) {
        console.log("Not able to decompress: " + err);
        process.exit(1);
      }
    });
  }
  start();
}

function killAll() {
  try {
    exec('killall -9 arangodb', (err, stdout, stderr) => {
      if (err) {
        //some err occurred
        if (program.debug) {
          console.log(err)
        }
      }
    });
  } catch (ignore) {
  }
  try {
    exec('killall -9 arangod', (err, stdout, stderr) => {
      if (err) {
        //some err occurred
        if (program.debug) {
          console.log(err)
        }
      }
    });
  } catch (ignore) {
  }
}

function analysePaths() {
  // we need to find binary files in extracted old & new folder
  // thanks to: https://stackoverflow.com/a/24594123
  const getDirectories = source =>
    readdirSync(source, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

  configuration.tmpNewSubDirectory = getDirectories(tmpNewDirectory)[0];
  configuration.tmpNewArangod = tmpNewDirectory + configuration.tmpNewSubDirectory + '/usr/sbin/arangod' // TODO: auto detect
  configuration.tmpNewStarter = tmpNewDirectory + configuration.tmpNewSubDirectory + '/usr/bin/arangodb' // TODO: auto detect
  configuration.tmpNewJS = tmpNewDirectory + configuration.tmpNewSubDirectory + '/usr/share/arangodb3/js' // TODO: auto detect
  configuration.tmpOldSubDirectory = getDirectories(tmpOldDirectory)[0];
  configuration.tmpOldArangod = tmpOldDirectory + configuration.tmpOldSubDirectory + '/usr/sbin/arangod' // TODO: auto detect
  configuration.tmpOldStarter = tmpOldDirectory + configuration.tmpOldSubDirectory + '/usr/bin/arangodb' // TODO: auto detect
  configuration.tmpOldJS = tmpOldDirectory + configuration.tmpOldSubDirectory + '/usr/share/arangodb3/js' // TODO: auto detect
}

async function start() {
  if (program.force) {
    killAll();
  }

  analysePaths();

  if (cmdValue === 'singleServer') {
    await testSingleServer();
  }

console.log("sleeping for 1000 sec");
await sleep(1000000000);
}

function makeAbsolutePath(path) {
  return process.cwd() + path.substr(1, path.length);
}

function buildStarterCommand(arangodb, arangod, databasePath, mode, js, removeOldDirectory, upgrade) {
  let cmd = '';
  if (arangodb) {
    cmd += makeAbsolutePath(arangodb);
  }
  if (arangod) {
    cmd += ' --server.arangod=' + makeAbsolutePath(arangod);
  }
  if (databasePath) {
    cmd += ' --starter.data-dir=' + makeAbsolutePath(databasePath);
    if (removeOldDirectory) {
      if (fs.existsSync(tmpDirectory + databasePath)) {
        rimraf.sync(tmpDirectory + databasePath); // will delete the directory
      }
    }
  }
  if (js) {
    cmd += ' --server.js-dir ' + makeAbsolutePath(js);
  }
  if (mode) {
    cmd += ' --starter.mode ' + mode;
  }
  if (upgrade) {
    cmd += ' --all.database.auto-upgrade true';
  }

  return cmd;
}

function execShellCommand(name, cmd) {
  var spawn = require('child_process').spawn;
  let fileName = name + '.sh';
  let fullFileName = makeAbsolutePath(tmpDirectory) + fileName;

  // we need to create a sh script first to execute it in background ...
  fs.writeFile(fullFileName, cmd, function(err) {
    if (err) {
      return console.log(err);
    }
    if (program.debug) {
      console.log("The file: " + fullFileName + " was saved!");
    }
  }); 
  exec('chmod a+x ' + fullFileName, (err, stdout, stderr) => {
    if (err) {
      //some err occurred
      if (program.debug) {
        console.error(err)
      }
    }
  });

  // now execute in background
  var child = spawn('/bin/sh', [fullFileName], {
    detached: true
  });

 child.stderr.on('data', function (data) {
    if (program.debug) {
      console.error("STDERR:", data.toString());
    }
  });
  child.stdout.on('data', function (data) {
    if (program.debug) {
      console.log("STDOUT:", data.toString());
    }
  });
  child.on('exit', function (exitCode) {
    if (program.debug) {
      console.log("Child exited with code: " + exitCode);
    }
  });
}

async function testSingleServer() {
  let cmd = buildStarterCommand(configuration.tmpNewStarter, configuration.tmpNewArangod, 'singleServer', 'single', configuration.tmpNewJS, true);
  execShellCommand('testSingleServer', cmd);
  return;
  try {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        //some err occurred
        if (program.debug) {
          console.error(err)
        }
      } else {
        console.log(stdout);
        console.log("Started ArangoDB Single Server, go to http://localhost:8529/ and start testing!");
      }
    });
  } catch (ignore) {
  }
}
