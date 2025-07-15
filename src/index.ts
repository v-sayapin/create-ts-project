import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import * as prompts from '@clack/prompts';
import mri from 'mri';

const HELP_MESSAGE = `\
Usage: create-ts-project [options] [<target-directory>]

Create a new project TypeScript project.
With no arguments, start the CLI in interactive mode.

Arguments:
  <target-directory>   Where to create the project (default: ./ts-project)
                       If omitted, the wizard will ask for the name.

Options:
  --overwrite          Delete existing files in the target directory
  -h, --help           Show this help and exit
`;

const DEFAULT_TARGET_DIR = 'ts-project';
const CWD = process.cwd();

const formatTargetDir = (targetDir: string) => targetDir.trim().replace(/\/+$|^\./g, '');

const parseArgv = (argv: Array<string>) => {
	const mriArgv = mri<{
		help?: boolean;
		overwrite?: boolean;
	}>(argv, {
		alias: { h: 'help', t: 'template' },
		boolean: ['help', 'overwrite'],
		string: ['template'],
	});

	return {
		targetDir: mriArgv._[0] ? formatTargetDir(mriArgv._[0]) : undefined,
		overwrite: Boolean(mriArgv.overwrite),
		help: Boolean(mriArgv.help),
	};
};

const cancel = () => prompts.cancel('Operation cancelled');

const resolveTargetDir = async (targetDirArg: string | undefined) => {
	if (targetDirArg) {
		return targetDirArg;
	}
	const projectName = await prompts.text({
		message: 'Project name:',
		defaultValue: DEFAULT_TARGET_DIR,
		placeholder: DEFAULT_TARGET_DIR,
		validate: (value) =>
			value.length === 0 || formatTargetDir(value).length > 0 ? undefined : 'Invalid project name',
	});
	if (prompts.isCancel(projectName)) {
		cancel();
	}
	return formatTargetDir(projectName.toString());
};

const checkExists = async (path: string) => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

const checkEmpty = async (dir: string) => {
	const files = await readdir(dir);
	return files.length === 0 || (files.length === 1 && files[0] === '.git');
};

const clearDir = async (dir: string) => {
	if (!(await checkExists(dir))) {
		return;
	}
	for (const file of await readdir(dir)) {
		if (file === '.git') {
			continue;
		}
		await rm(resolve(dir, file), { recursive: true, force: true });
	}
};

const handleExistingDirectory = async (targetDir: string, overwriteArg: boolean) => {
	if (!(await checkExists(targetDir)) || (await checkEmpty(targetDir))) {
		return;
	}
	const overwrite = overwriteArg
		? 'yes'
		: await prompts.select({
				message: `${targetDir === '.' ? 'Current directory' : `Target directory "${targetDir}"`} is not empty. Choose how to proceed:`,
				options: [
					{ label: 'Cancel operation', value: 'no' },
					{ label: 'Remove existing files and continue', value: 'yes' },
					{ label: 'Ignore files and continue', value: 'ignore' },
				],
			});
	if (prompts.isCancel(overwrite)) {
		cancel();
	}
	switch (overwrite) {
		case 'yes':
			await clearDir(targetDir);
			break;
		case 'no':
			cancel();
			break;
	}
};

const isValidPackageName = (name: string) => /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(name);

const toValidPackageName = (name: string) =>
	name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/^[._]/, '')
		.replace(/[^a-z\d\-~]+/g, '-');

const resolvePackageName = async (targetDir: string) => {
	const packageName = basename(resolve(targetDir));
	if (isValidPackageName(packageName)) {
		return packageName;
	}
	const response = await prompts.text({
		message: 'Package name:',
		defaultValue: toValidPackageName(packageName),
		placeholder: toValidPackageName(packageName),
		validate: (name) => (isValidPackageName(name) ? undefined : 'Invalid package.json name'),
	});
	if (prompts.isCancel(response)) {
		cancel();
	}
	return response.toString();
};

const copy = async (src: string, dest: string) => {
	const srcStat = await stat(src);
	if (srcStat.isDirectory()) {
		await copyDir(src, dest);
	} else {
		await copyFile(src, dest);
	}
};

const copyDir = async (srcDir: string, destDir: string) => {
	await mkdir(destDir, { recursive: true });
	for (const file of await readdir(srcDir)) {
		const srcFile = resolve(srcDir, file);
		const destFile = resolve(destDir, file);
		await copy(srcFile, destFile);
	}
};

type CreateProjectOptions = {
	root: string;
	packageName: string;
};

const createProject = async ({ root, packageName }: CreateProjectOptions) => {
	prompts.log.step(`Creating project in ${root}...`);

	const templateDir = resolve(fileURLToPath(import.meta.url), '../..', 'templates/ts');

	const write = async (file: string, content?: string) => {
		const targetFile = join(root, file);
		if (content) {
			await writeFile(targetFile, content);
		} else {
			await copy(join(templateDir, file), targetFile);
		}
	};

	await mkdir(root, { recursive: true });

	for (const file of (await readdir(templateDir)).filter((file) => file !== 'package.json')) {
		await write(file);
	}

	const pkg = JSON.parse(await readFile(join(templateDir, 'package.json'), 'utf-8'));
	pkg.name = packageName;
	await write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
};

const pkgFromUserAgent = (userAgent: string | undefined) => {
	if (!userAgent) {
		return undefined;
	}
	const [pkgSpec] = userAgent.split(' ');
	const [name, version] = pkgSpec.split('/');
	return { name, version };
};

const printCompletionMessage = (root: string) => {
	let message = 'Done. Now run:\n';

	const cdProjectName = relative(CWD, root);
	if (root !== CWD) {
		message += `\n  cd ${cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName}`;
	}

	const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent);
	const pkgManager = pkgInfo ? pkgInfo.name : 'npm';

	switch (pkgManager) {
		case 'yarn':
			message += '\n  yarn';
			message += '\n  yarn dev';
			break;
		default:
			message += `\n  ${pkgManager} install`;
			message += `\n  ${pkgManager} run dev`;
	}

	prompts.outro(message);
};

const main = async () => {
	const argv = parseArgv(process.argv.slice(2));

	if (argv.help) {
		console.log(HELP_MESSAGE);
		return;
	}

	const targetDir = await resolveTargetDir(argv.targetDir);
	await handleExistingDirectory(targetDir, argv.overwrite);
	const packageName = await resolvePackageName(targetDir);

	const targetDirPath = join(CWD, targetDir);
	await createProject({ root: targetDirPath, packageName });
	printCompletionMessage(targetDirPath);
};

try {
	await main();
} catch (error) {
	console.error(error);
	process.exit(1);
}
