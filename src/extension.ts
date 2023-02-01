import * as path from 'path';
import { promises as fs, open } from 'fs';
import * as os from 'os';
import * as process from 'process';

import * as yaml from 'yaml';
import * as vscode from 'vscode';
import * as jsoncParser from 'jsonc-parser';
import * as prettier from 'prettier';

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
        if ([".json", ".code-snippets"].includes(path.extname(file))) {
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
        if (![".code-snippets"].includes(path.extname(file))) {
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
            description: "opened file " + (available ? openedLangID + ".json" : ""),
            available: availableList.includes(openedLangID),
            path: path.join(snippetsDir, openedLangID + ".json"),
        });
    }
    for (const langID of availableList) {
        if (langID === openedLangID) {
            continue;
        }
        result.push({
            label: langID,
            languageID: langID,
            description: langID + ".json",
            available: true,
            path: path.join(snippetsDir, langID + ".json"),
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
            path: path.join(snippetsDir, langID + ".json"),
        });
    }
    return result;
}

async function listWorkspaceSnippetsItems(snippetsDir: string): Promise<PickSnippetsItem[]> {
    const result: PickSnippetsItem[] = [];

    const availableList = await getWorkspaceSnippets(snippetsDir);
    availableList.forEach(workspaceSnippet => {
        result.push({
            label: workspaceSnippet.toString(),
            languageID: "foo",
            description: "Workspace snippets: " + workspaceSnippet.toString(),
            available: true,
            path: path.join(snippetsDir, workspaceSnippet + ".code-snippets"),
        });
    })

    return result
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
    const userOrWorkspace = { "user": { "ext": ".json", "path": snippetsDir }, "workspace": {} }

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
    if (vscode.workspace.workspaceFolders) {
        const workspaceSnippets = vscode.workspace.workspaceFolders[0].uri.fsPath + "\\.vscode";
        userOrWorkspace["workspace"] = { "ext": ".code-snippets", "path": workspaceSnippets }

        disposable = vscode.commands.registerCommand('editing-snippets-by-yaml.configureWorkplaceSnippets', async () => {
            const items = await listWorkspaceSnippetsItems(workspaceSnippets);
            const selected = await vscode.window.showQuickPick(items);
            if (!selected) {
                return;
            }
            const yamlPath = await convertYAMLSnippets(selected.path, selected.available);
            await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(yamlPath));

        });
        context.subscriptions.push(disposable);
        disposable = vscode.workspace.onDidCloseTextDocument(async (doc) => {
            const yamlPath = doc.fileName;
            const mode = yamlPath.includes(".code-snippets.yaml")
            const useDirectory = mode ? workspaceSnippets : snippetsDir
            const useExt = mode ? ".code-snippets" : ".json"
            if (!isYAMLSnippetsPath(yamlPath, useDirectory, useExt)) {
                return;
            }
            try {
                await convertJSONSnippets(yamlPath);
            } catch (e) {
                vscode.window.showErrorMessage(`cannot create json : ${e.message}`);
            }
            fs.unlink(yamlPath);
        });
        context.subscriptions.push(disposable);

        disposable = vscode.workspace.onDidSaveTextDocument(async (doc) => {
            const yamlPath = doc.fileName;
            const mode = yamlPath.includes(".code-snippets.yaml")
            const useDirectory = mode ? workspaceSnippets : snippetsDir
            const useExt = mode ? ".code-snippets" : ".json"
            if (!isYAMLSnippetsPath(yamlPath, useDirectory, useExt)) {
                return;
            }
            try {
                await convertJSONSnippets(yamlPath);
            } catch (e) {
                vscode.window.showErrorMessage(`cannot create json : ${e.message}`);
            }
        });
        context.subscriptions.push(disposable);
    }
}


export function deactivate() { }
