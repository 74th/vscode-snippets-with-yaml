import * as path from 'path';
import { promises as fs, open } from 'fs'

import * as yaml from 'yaml';
import * as vscode from 'vscode';
import * as jsoncParser from 'jsonc-parser';
import * as prettier from 'prettier';
// import { windows, android, linux, macos, tizen } from 'platform-detect/os';

interface Snippet {
    prefix: string
    body: string[] | string
    description?: string
}
type SnippetDocument = { [index: string]: Snippet };

function getSnippetsDir(): string {
    return "/home/nnyn/.config/Code - Insiders/User/snippets";
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
        if (path.extname(file) !== ".json") {
            continue;
        }
        languages.push(path.basename(file, ".json"));
    }
    return languages;
}

interface PickSnippetsItem extends vscode.QuickPickItem {
    languageID: string
    path: string
    available: boolean
}

async function listSnipeetsLanguageItems(snippetsDir: string): Promise<PickSnippetsItem[]> {
    const result: PickSnippetsItem[] = [];

    const langList = await vscode.languages.getLanguages()
    const availableList = await getAvailableSnippets(snippetsDir);

    let openedLangID: string | null = null;

    if (vscode.window.activeTextEditor) {
        openedLangID = vscode.window.activeTextEditor.document.languageId;
        result.push({
            label: openedLangID,
            languageID: openedLangID,
            detail: "detail-opened",
            description: "description-opened",
            available: availableList.includes(openedLangID),
            path: path.join(snippetsDir, openedLangID + ".json"),
        })
    }
    for (const langID of availableList) {
        if (langID === openedLangID) {
            continue;
        }
        result.push({
            label: langID,
            languageID: langID,
            detail: "detail-available",
            description: "description-available",
            available: true,
            path: path.join(snippetsDir, langID + ".json"),
        })
    }

    for (const langID of langList) {
        if (langID === openedLangID || availableList.includes(langID)) {
            continue;
        }
        result.push({
            label: langID,
            languageID: langID,
            detail: "detail-new",
            description: "description-new",
            available: false,
            path: path.join(snippetsDir, langID + ".json"),
        })
    }
    return result;
}

async function convertYAMLSnippets(jsonPath: string, available: boolean): Promise<string> {
    const yamlPath = jsonPath + ".yaml";
    let doc: SnippetDocument = {};
    if (available) {
        const docByte = await fs.readFile(jsonPath)
        doc = jsoncParser.parse(docByte.toString("utf-8"))
    } else {
        doc = {}
        doc["Print to console"] = {
            prefix: "log",
            body: [
                "console.log('$1');",
                "$2"
            ],
            description: "Log output to console"
        }
    }

    for (const i in doc) {
        if (Array.isArray(doc[i].body)) {
            doc[i].body = (doc[i].body as string[]).join("\n");
        }
    }

    await fs.writeFile(yamlPath, yaml.stringify(doc), { encoding: "utf-8" });
    return yamlPath;
}

function isYAMLSnippetsPath(yamlPath: string, snippetsDir: string): boolean {
    return snippetsDir == path.dirname(yamlPath) && path.basename(yamlPath).endsWith(".json.yaml");
}

async function convertJSONSnippets(yamlPath: string) {
    const doc = yaml.parse(await fs.readFile(yamlPath, { encoding: "utf-8" }))

    for (const name in doc) {
        const body = doc[name]["body"];
        if (typeof body === "string" && body.includes("\n")) {
            doc[name]["body"] = body.split("\n");
        }
    }

    let jsonDoc = JSON.stringify(doc);
    jsonDoc = prettier.format(jsonDoc, { parser: "json" });
    const jsonPath = path.join(path.dirname(yamlPath), path.basename(yamlPath, ".yaml"));
    await fs.writeFile(jsonPath, jsonDoc, { encoding: "utf-8" })
}


export async function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "editing-snippets-by-yaml" is now active!');
    const snippetsDir = getSnippetsDir();

    let disposable = vscode.commands.registerCommand('editing-snippets-by-yaml.configureUserSnippets', async () => {
        const items = await listSnipeetsLanguageItems(snippetsDir);
        const selected = await vscode.window.showQuickPick(items)
        if (!selected) {
            return
        }
        const yamlPath = await convertYAMLSnippets(selected.path, selected.available);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(yamlPath));

    });
    context.subscriptions.push(disposable);

    disposable = vscode.workspace.onDidCloseTextDocument(async (e) => {
        const yamlPath = e.fileName;
        if (!isYAMLSnippetsPath(yamlPath, snippetsDir)) {
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

}


// this method is called when your extension is deactivated
export function deactivate() { }
