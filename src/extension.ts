import * as path from 'path';
import { promises as fs, open } from 'fs';
import * as os from 'os';
import * as process from 'process';

import * as yaml from 'yaml';
import * as vscode from 'vscode';
import * as jsoncParser from 'jsonc-parser';
import * as prettier from 'prettier';

const USER_SNIPPETS_EXT = ".json";
const WORKSPACE_SNIPPETS_EXT = ".code-snippets";

interface Snippet {
    prefix: string
    body: string[] | string
    description?: string
}
type SnippetDocument = { [index: string]: Snippet };

function getSnippetsDir(): string {

    let codeName = "Code";
    if (vscode.env.appName.includes("Insiders")) {
        codeName = "Code - Insiders";
    }
    if (vscode.env.appName.includes("OSS")) {
        codeName = "Code - OSS";
    }
    let base = "";
    switch (os.platform()) {
        case "win32":
            base = process.env["APPDATA"] as string;
            break;
        case "darwin":
            base = path.join(process.env["HOME"] as string, "Library", "Application Support");
            break;
        default:
            base = path.join(process.env["HOME"] as string, ".config");
            break;
    }
    return path.join(base, codeName, "User", "snippets");
}

async function getAvailableSnippets(snippetsDir: string): Promise<string[]> {

    let files: string[];
    try {
        files = await fs.readdir(snippetsDir);
    } catch (e) {
        console.log(e);
        return [];
    }
    const languages: string[] = [];
    for (const file of files) {
        if (path.extname(file) !== USER_SNIPPETS_EXT) {
            continue;
        }
        languages.push(path.basename(file, path.extname(file)));
    }
    return languages;
}

async function getWorkspaceSnippets(snippetsDir: string): Promise<string[]> {

    let files: string[];
    try {
        files = await fs.readdir(snippetsDir);
    } catch (e) {
        console.log(e);
        return [];
    }
    const workspaceSnippets: string[] = [];
    for (const file of files) {
        if (path.extname(file) !== WORKSPACE_SNIPPETS_EXT) {
            continue;
        }
        workspaceSnippets.push(path.basename(file, path.extname(file)));
    }
    return workspaceSnippets;
}

interface PickSnippetsItem extends vscode.QuickPickItem {
    languageID: string
    path: string
    available: boolean
}

async function listSnippetsLanguageItems(snippetsDir: string): Promise<PickSnippetsItem[]> {
    const result: PickSnippetsItem[] = [];

    const langList = await vscode.languages.getLanguages();
    const availableList = await getAvailableSnippets(snippetsDir);

    let openedLangID: string | null = null;

    if (vscode.window.activeTextEditor) {
        openedLangID = vscode.window.activeTextEditor.document.languageId;
        const available = availableList.includes(openedLangID);
        result.push({
            label: openedLangID,
            languageID: openedLangID,
            description: "opened file " + (available ? openedLangID + USER_SNIPPETS_EXT : ""),
            available: availableList.includes(openedLangID),
            path: path.join(snippetsDir, openedLangID + USER_SNIPPETS_EXT),
        });
    }
    for (const langID of availableList) {
        if (langID === openedLangID) {
            continue;
        }
        result.push({
            label: langID,
            languageID: langID,
            description: langID + USER_SNIPPETS_EXT,
            available: true,
            path: path.join(snippetsDir, langID + USER_SNIPPETS_EXT),
        });
    }

    for (const langID of langList) {
        if (langID === openedLangID || availableList.includes(langID)) {
            continue;
        }
        result.push({
            label: langID,
            languageID: langID,
            available: false,
            path: path.join(snippetsDir, langID + USER_SNIPPETS_EXT),
        });
    }
    return result;
}

async function listWorkspaceSnippetsItems(snippetsDir: string): Promise<PickSnippetsItem[]> {
    const result: PickSnippetsItem[] = [];

    const langList = await vscode.languages.getLanguages();
    const availableList = await getWorkspaceSnippets(snippetsDir);

    let openedLangID: string | null = null;

    if (vscode.window.activeTextEditor) {
        openedLangID = vscode.window.activeTextEditor.document.languageId;
        const available = availableList.includes(openedLangID);
        result.push({
            label: openedLangID,
            languageID: openedLangID,
            description: "opened file " + (available ? openedLangID + WORKSPACE_SNIPPETS_EXT : ""),
            available: availableList.includes(openedLangID),
            path: path.join(snippetsDir, openedLangID + WORKSPACE_SNIPPETS_EXT),
        });
    }
    availableList.forEach(workspaceSnippet => {
        if (workspaceSnippet === openedLangID) {
            return;
        }
        result.push({
            label: workspaceSnippet.toString(),
            languageID: "",
            description: "Workspace snippets: " + workspaceSnippet.toString(),
            available: true,
            path: path.join(snippetsDir, workspaceSnippet + WORKSPACE_SNIPPETS_EXT),
        });
    });

    for (const langID of langList) {
        if (langID === openedLangID || availableList.includes(langID)) {
            continue;
        }
        result.push({
            label: langID,
            languageID: langID,
            available: false,
            path: path.join(snippetsDir, langID + USER_SNIPPETS_EXT),
        });
    }

    return result;
}

async function convertYAMLSnippets(jsonPath: string, available: boolean): Promise<string> {
    const yamlPath = jsonPath + ".yaml";
    let doc: SnippetDocument = {};
    if (available) {
        const docByte = await fs.readFile(jsonPath);
        doc = jsoncParser.parse(docByte.toString("utf-8"));
    } else {
        doc = {};
        doc["Print to console"] = {
            prefix: "log",
            body: [
                "console.log('$1');",
                "$2"
            ],
            description: "Log output to console"
        };
    }

    for (const i in doc) {
        if (Array.isArray(doc[i].body)) {
            doc[i].body = (doc[i].body as string[]).join("\n");
        }
    }

    yaml.scalarOptions.str.fold.lineWidth = 1000;
    await fs.writeFile(yamlPath, yaml.stringify(doc), { encoding: "utf-8" });
    return yamlPath;
}

function isYAMLSnippetsPath(yamlPath: string, snippetsDir: string, useExt: string): boolean {
    return snippetsDir.toLowerCase() === path.dirname(yamlPath).toLowerCase() && path.basename(yamlPath).endsWith(useExt + ".yaml");
}

async function convertJSONSnippets(yamlPath: string) {
    const doc = yaml.parse(await fs.readFile(yamlPath, { encoding: "utf-8" }));

    for (const name in doc) {
        const body = doc[name]["body"];
        if (typeof body === "string" && body.includes("\n")) {
            doc[name]["body"] = body.split("\n");
        }
    }

    let jsonDoc = JSON.stringify(doc);
    jsonDoc = prettier.format(jsonDoc, { parser: "json" });
    const jsonPath = path.join(path.dirname(yamlPath), path.basename(yamlPath, ".yaml"));
    await fs.writeFile(jsonPath, jsonDoc, { encoding: "utf-8" });
}

export async function activate(context: vscode.ExtensionContext) {
    const snippetsDir = getSnippetsDir();

    let disposable = vscode.commands.registerCommand('editing-snippets-by-yaml.configureUserSnippets', async () => {
        const items = await listSnippetsLanguageItems(snippetsDir);
        const selected = await vscode.window.showQuickPick(items);
        if (!selected) {
            return;
        }
        const yamlPath = await convertYAMLSnippets(selected.path, selected.available);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(yamlPath));
    });
    context.subscriptions.push(disposable);

    // If in a workspace, this option is available.
    if (vscode.workspace.workspaceFolders) {

        const workspaceSnippets = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, ".vscode");
        disposable = vscode.commands.registerCommand('editing-snippets-by-yaml.configureWorkplaceSnippets', async () => {
            const items = await listWorkspaceSnippetsItems(workspaceSnippets);
            var selected;

            if (items.length && items.length > 1) {
                selected = await vscode.window.showQuickPick(items);
            } else if (items.length === 1) {
                selected = items[0];
            }

            if (!selected) {
                return;
            }

            const yamlPath = await convertYAMLSnippets(selected.path, selected.available);
            await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(yamlPath));
        });

        context.subscriptions.push(disposable);
        disposable = vscode.workspace.onDidCloseTextDocument(async (doc) => {
            const { yamlPath, directory, ext } = modeVariables(doc, workspaceSnippets, snippetsDir);
            if (!isYAMLSnippetsPath(yamlPath, directory, ext)) {
                return;
            }
            try {
                await convertJSONSnippets(yamlPath);
            } catch (e) {
                vscode.window.showErrorMessage(`cannot create json : ${e}`);
            }
            fs.unlink(yamlPath);
        });
        context.subscriptions.push(disposable);

        disposable = vscode.workspace.onDidSaveTextDocument(async (doc) => {
            const { yamlPath, directory, ext } = modeVariables(doc, workspaceSnippets, snippetsDir);
            if (!isYAMLSnippetsPath(yamlPath, directory, ext)) {
                return;
            }
            try {
                await convertJSONSnippets(yamlPath);
            } catch (e) {
                vscode.window.showErrorMessage(`cannot create json : ${e}`);
            }
        });
        context.subscriptions.push(disposable);
    }
}

function modeVariables(doc: { fileName: string }, workspaceSnippets: string, snippetsDir: string) {
    const yamlPath = doc.fileName;
    const mode = yamlPath.includes(WORKSPACE_SNIPPETS_EXT + ".yaml");
    const useDirectory = mode ? workspaceSnippets : snippetsDir;
    const useExt = mode ? WORKSPACE_SNIPPETS_EXT : USER_SNIPPETS_EXT;
    return { "yamlPath": yamlPath, "directory": useDirectory, "ext": useExt };
}

export function deactivate() { }
