var _ = require('lodash');
var cmds = require('./lib/cmds');
var auth = require('./lib/middleware/auth');
var fs = require('fs');
var execSync = require('child_process').execSync;

var CATEGORIES = {
  set: 'SECRETS',
  unset: 'SECRETS',
  view: 'SECRETS',
  run: 'SECRETS',

  signup: 'ACCOUNT',
  verify: 'ACCOUNT',

  allow: 'ACCESS CONTROL',
  deny: 'ACCESS CONTROL',
  policies: 'ACCESS CONTROL',

  orgs: 'ORGANIZATIONS',
  invites: 'ORGANIZATIONS',
  keypairs: 'ORGANIZATIONS',
  envs: 'ORGANIZATIONS',
  services: 'ORGANIZATIONS',
  teams: 'ORGANIZATIONS'
};

// These toplevel commands become `list` subcommands of themselves. The toplevel
// commands are already implemented in go.
var REPLACEMENTS = {
  orgs: true,
  invites: true,
  keypairs: true,
  envs: true,
  services: true,
  teams: true,
  policies: true
};

var DAEMON_MIDDLEWARE_BLACKLIST = {
  prefs: true
};

function mungeCmd(mungedCmds, cmd) {
  var name = cmd.subpath;
  var lookup = cmd.slug;

  if (REPLACEMENTS[cmd.slug]) {
    name = 'list';
    lookup = lookup + ':list';
  }

  var middlewares = [];
  if (!DAEMON_MIDDLEWARE_BLACKLIST[cmd.group]) {
    middlewares.push('cmd.EnsureDaemon');
  }

  if (_.find(cmd.preHooks, function (o) { return o.fn === auth(); })) {
    middlewares.push('cmd.EnsureSession');
  }

  var argsUsage = cmd.usage.slice(cmd.slug.length + 1);
  var newcmd = {
    name: name,
    usage: cmd.description,
    argsUsage: argsUsage,
    subcmds: [],
    flags: cmd.options,
    slug: cmd.slug,
    middlewares: middlewares
  };

  if (cmd.group && name !== cmd.group) {
    var group = mungedCmds[cmd.group] || {
      name: cmd.group,
      flags: [],
      skipExec: true,
      subcmds: [],
      middlewares: []
    };
    group.subcmds.push(newcmd);
    mungedCmds[cmd.group] = group;
  } else {
    mungedCmds[lookup] = newcmd;
  }
}

function dumpFlag(f, flag, indent) {
  var usePrefOptions = false;
  var pad = _.repeat(' ', indent);

  var name = flag.long.slice(2) + ', ' + flag.short.slice(1);

  if (flag.long === '--org') {
    f.write(pad + 'cmd.StdOrgFlag,\n');
    usePrefOptions = true;
  } else if (flag.long === '--project') {
    f.write(pad + 'cmd.StdProjectFlag,\n');
    usePrefOptions = true;
  } else if (flag.long === '--environment') {
    f.write(pad + 'cmd.StdEnvFlag,\n');
    usePrefOptions = true;
  } else if (flag.long === '--service') {
    f.write(pad + 'cmd.StdServiceFlag,\n');
    usePrefOptions = true;
  } else if (flag.long === '--user') {
    f.write(pad + 'cmd.StdUserFlag,\n');
    usePrefOptions = true;
  } else if (flag.long === '--instance') {
    f.write(pad + 'cmd.StdInstanceFlag,\n');
    usePrefOptions = true;
  } else {
    if (flag.bool) {
      f.write(pad + 'cli.BoolFlag{\n');
    } else {
      f.write(pad + 'cli.StringFlag{\n');
      if (flag.defaultValue) {
        f.write(pad + '    Value: "' + flag.defaultValue + '",\n');
      }
    }

    f.write(pad + '    Name: "' + name + '",\n');
    f.write(pad + '    Usage: "' + flag.description + '",\n');
    f.write(pad + '},\n');
  }

  return usePrefOptions;
}

function dumpCmd(f, cmd, indent) {
  var pad = _.repeat(' ', indent);
  f.write(pad + '{\n');
  f.write(pad + '    Name: "' + cmd.name + '",\n');
  f.write(pad + '    Usage: "' + cmd.usage + '",\n');

  if (cmd.argsUsage) {
    f.write(pad + '    ArgsUsage: "' + cmd.argsUsage + '",\n');
  }

  if (CATEGORIES[cmd.name]) {
    f.write(pad + '    Category: "' + CATEGORIES[cmd.name] + '",\n');
  }

  if (cmd.subcmds.length > 0) {
    f.write(pad + '    Subcommands: []cli.Command{\n');
    cmd.subcmds.forEach(function (sub) {
      dumpCmd(f, sub, indent + 8);
    });
    f.write(pad + '    },\n');
  }

  var usePrefOptions = false;
  if (cmd.flags.length > 0) {
    f.write(pad + '    Flags: []cli.Flag{\n');
    cmd.flags.forEach(function (flag) {
      usePrefOptions |= dumpFlag(f, flag, indent + 8);
    });
    f.write(pad + '    },\n');
  }

  if (usePrefOptions) {
    cmd.middlewares.push('cmd.LoadDirPrefs');
    cmd.middlewares.push('cmd.LoadPrefDefaults');
    cmd.middlewares.push('cmd.SetUserEnv');
  }

  if (!cmd.skipExec) {
    var slugLen = 1 + cmd.slug.split(':').length;

    if (cmd.middlewares.length > 0) {
      f.write(pad + '    Action: cmd.Chain(' + cmd.middlewares.join(', ') + ',\n');
    } else {
      f.write(pad + '    Action: \n');
    }

    f.write(pad + '        func(ctx *cli.Context) error {\n' +
            pad + '        return passthrough(ctx, ' + slugLen + ', "' + cmd.slug + '")\n' +
            pad + '    },\n');

    if (cmd.middlewares.length > 0) {
      f.write(pad + '    ),\n');
    }
  }

  f.write(pad + '},\n');
}

cmds.get().then(function (cmdList) {
  var mungedCmds = {};
  cmdList.forEach(function (cmd) {
    mungeCmd(mungedCmds, cmd);
  });

  var f = fs.createWriteStream('passthrough.go');
  f.write('// THIS FILE IS AUTOMATICALLY GENERATED. DO NOT EDIT!\n');
  f.write('package main\n');
  f.write('import "github.com/urfave/cli"\n');
  f.write('import "github.com/arigatomachine/cli/cmd"\n');
  f.write('\n');
  f.write('var passthroughs = []cli.Command{\n');

  _.forEach(mungedCmds, function (cmd) {
    dumpCmd(f, cmd, 4);
  });

  f.write('}\n');

  f.write('\n');
  f.write('func mergeCmds(a, b []cli.Command) []cli.Command {\n');
  f.write('	am := map[string]cli.Command{}\n');
  f.write('\n');
  f.write('	for _, cmd := range a {\n');
  f.write('		am[cmd.Name] = cmd\n');
  f.write('	}\n');
  f.write('\n');
  f.write('	for _, cmdB := range b {\n');
  f.write('		if cmdA, ok := am[cmdB.Name]; ok {\n');
  f.write('			cmdA.Subcommands = mergeCmds(cmdA.Subcommands, cmdB.Subcommands)\n');
  f.write('			am[cmdA.Name] = cmdA\n');
  f.write('		} else {\n');
  f.write('			am[cmdB.Name] = cmdB\n');
  f.write('		}\n');
  f.write('	}\n');
  f.write('\n');
  f.write('	c := []cli.Command{}\n');
  f.write('	for _, cmd := range am {\n');
  f.write('		c = append(c, cmd)\n');
  f.write('	}\n');
  f.write('\n');
  f.write('	return c\n');
  f.write('}\n');
  f.write('\n');
  f.write('func init() {\n');
  f.write('	cmd.Cmds = mergeCmds(cmd.Cmds, passthroughs)\n');
  f.write('}\n');
  f.write('\n');

  f.end(null, null, function () {
    execSync('gofmt -w passthrough.go');
  });
});
