const vscode = require('vscode');
const axios = require('axios');

// Конфигурация Supabase
const SUPABASE_CONFIG = {
    baseUrl: 'https://hyttejcjytbgbdfgehhd.supabase.co/rest/v1',
    apiKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5dHRlamNqeXRiZ2JkZmdlaGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTcyNDksImV4cCI6MjA3MzczMzI0OX0.SBzMCdm8uPtL01vcGLZSAm0aVeTHobBJrzrjETN1sGo'
};

// URL endpoints
const ENDPOINTS = {
    documents: `${SUPABASE_CONFIG.baseUrl}/websoft_documentation_developer_data`,
    categories: `${SUPABASE_CONFIG.baseUrl}/websoft_documentation_developer_category`
};

// Класс для представления элемента дерева
class TreeItem extends vscode.TreeItem {
    constructor(label, collapsibleState, type = 'file', children = [], id = null, documentationData = null) {
        super(label, collapsibleState);
        this.children = children;
        this.type = type;
        this.contextValue = type;
        this.id = id;
        this.documentationData = documentationData;
        
        // Устанавливаем иконки в зависимости от типа
        switch (type) {
            case 'folder':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'document':
                this.iconPath = new vscode.ThemeIcon('file-text');
                break;
            case 'function':
                this.iconPath = new vscode.ThemeIcon('symbol-method');
                break;
            case 'api':
                this.iconPath = new vscode.ThemeIcon('cloud');
                break;
            case 'loading':
                this.iconPath = new vscode.ThemeIcon('loading');
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error');
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('file');
        }

        // Для элементов документации устанавливаем команду для показа
        if (type === 'document' || type === 'function') {
            this.command = {
                command: 'treeview-activitybar-demo.showDocumentation',
                title: 'Show Documentation',
                arguments: [this]
            };
        }
    }
}

// Провайдер данных для основного TreeView
class TreeDataProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.data = this.getInitialData();
        this.supabaseData = [];
        this.categoriesMap = new Map();
        this.isLoading = false;
        this.allDocumentItems = [];
        this.categoriesData = new Map(); // Храним исходные данные категорий
        this.currentCollapseState = vscode.TreeItemCollapsibleState.Collapsed; // Текущее состояние по умолчанию
    }

    // Перестроить дерево с текущим состоянием свернутости
    rebuildTreeView() {
        if (this.categoriesData.size === 0) return;

        // Создаем НОВЫЕ элементы категорий с текущим состоянием свернутости
        const documentationChildren = Array.from(this.categoriesData.entries()).map(([categoryTitle, docs]) => 
            new TreeItem(
                categoryTitle,
                this.currentCollapseState, // ← состояние берётся отсюда
                'folder',
                docs.map(doc => 
                    new TreeItem(
                        doc.title || 'Без названия',
                        vscode.TreeItemCollapsibleState.None,
                        doc.type || 'document',
                        [],
                        doc.id,
                        doc
                    )
                ),
                categoryTitle // ← УНИКАЛЬНЫЙ ID ДЛЯ КАТЕГОРИИ (важно!)
            )
        );

        // Добавляем категорию "Без категории"
        const uncategorizedDocs = Array.from(this.categoriesData.entries())
            .flatMap(([categoryTitle, docs]) => categoryTitle === 'Без категории' ? docs : [])
            .concat(this.supabaseData.filter(doc => !doc.category && !this.categoriesData.has('Без категории')));

        if (uncategorizedDocs.length > 0) {
            documentationChildren.push(
                new TreeItem(
                    'Без категории',
                    this.currentCollapseState,
                    'folder',
                    uncategorizedDocs.map(doc => 
                        new TreeItem(
                            doc.title || 'Без названия',
                            vscode.TreeItemCollapsibleState.None,
                            doc.type || 'document',
                            [],
                            doc.id,
                            doc
                        )
                    ),
                    'uncategorized' // ← уникальный ID для этой категории
                )
            );
        }

        // Обновляем КОРНЕВОЙ массив — создаём НОВЫЙ массив
        this.data = [...documentationChildren]; // ← spread для гарантии нового массива

        // Явно говорим VS Code: перерисуй ВСЁ дерево
        this._onDidChangeTreeData.fire(undefined);
    }

    // Загрузка данных из Supabase с join таблиц
    async loadFromSupabase() {
        console.log('Starting Supabase data load with categories...');

        return new Promise((resolve, reject) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: '🔄 Загрузка документации с категориями...',
                cancellable: false
            }, async (progress) => {
                try {
                    progress.report({ increment: 0 });

                    // 1. Сначала загружаем категории
                    console.log('Loading categories...');
                    const categoriesResponse = await axios.get(ENDPOINTS.categories, {
                        headers: {
                            'apikey': SUPABASE_CONFIG.apiKey,
                            'Authorization': `Bearer ${SUPABASE_CONFIG.apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    });

                    const categories = categoriesResponse.data;
                    
                    // Создаем mapping UUID -> название категории
                    this.categoriesMap = new Map();
                    categories.forEach(category => {
                        this.categoriesMap.set(category.id, category.title);
                    });

                    progress.report({ increment: 30 });

                    // 2. Загружаем документы
                    console.log('Loading documents...');
                    const documentsResponse = await axios.get(ENDPOINTS.documents, {
                        headers: {
                            'apikey': SUPABASE_CONFIG.apiKey,
                            'Authorization': `Bearer ${SUPABASE_CONFIG.apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    });

                    const documents = documentsResponse.data;
                    
                    // 3. Обогащаем документы названиями категорий
                    const enrichedDocuments = documents.map(doc => {
                        const categoryTitle = this.categoriesMap.get(doc.category) || 'Без категории';
                        return {
                            ...doc,
                            categoryTitle: categoryTitle,
                            categoryId: doc.category
                        };
                    });

                    progress.report({ increment: 60 });

                    // Сохраняем все элементы для QuickPick
                    this.allDocumentItems = enrichedDocuments.map(doc => ({
                        ...doc,
                        label: doc.title || 'Без названия',
                        description: doc.categoryTitle || 'Без категории',
                        detail: doc.description ? doc.description.substring(0, 50) + '...' : 'Описание отсутствует'
                    }));

                    // Сохраняем данные категорий для пересоздания
                    this.categoriesData = this.groupDocumentsByCategory(enrichedDocuments);
                    
                    // Сохраняем данные
                    this.supabaseData = enrichedDocuments;

                    // Устанавливаем начальное состояние - СВЕРНУТО
                    this.currentCollapseState = vscode.TreeItemCollapsibleState.Collapsed;
                    this.rebuildTreeView();

                    progress.report({ increment: 100 });

                    vscode.window.showInformationMessage(
                        `✅ Загружено ${documents.length} документов из ${this.categoriesData.size} категорий (все категории свернуты)`
                    );

                    resolve(enrichedDocuments);

                } catch (error) {
                    console.error('Supabase load error:', error.response?.data || error.message);
                    
                    let errorMessage = 'Неизвестная ошибка';
                    if (error.response) {
                        errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
                        if (error.response.status === 404) {
                            errorMessage += '. Проверьте названия таблиц в Supabase.';
                        }
                    } else if (error.request) {
                        errorMessage = 'Нет ответа от сервера';
                    } else {
                        errorMessage = error.message;
                    }
                    
                    reject(new Error(errorMessage));
                }
            });
        });
    }

    // Начальные данные с индикатором загрузки
    getInitialData() {
        return [
            new TreeItem('Загрузка документации...', vscode.TreeItemCollapsibleState.None, 'loading')
        ];
        // return [
        //     new TreeItem('Загрузка документации...', vscode.TreeItemCollapsibleState.None, 'loading'),
		// 	// new TreeItem('WebSoft Documentation', vscode.TreeItemCollapsibleState.Expanded, 'api', [
        //     //     new TreeItem('Загрузка документации...', vscode.TreeItemCollapsibleState.None, 'loading')
        //     // ]),
        //     // new TreeItem('Lorem Ipsum Dolor', vscode.TreeItemCollapsibleState.Expanded, 'folder', [
        //     //     // new TreeItem('src', vscode.TreeItemCollapsibleState.Collapsed, 'folder', [
        //     //     //     // new TreeItem('App.tsx', vscode.TreeItemCollapsibleState.None, 'typescript'),
        //     //     //     // new TreeItem('index.tsx', vscode.TreeItemCollapsibleState.None, 'typescript')
        //     //     // ]),
        //     //     new TreeItem('package.json', vscode.TreeItemCollapsibleState.None, 'json')
        //     // ]),
            
        // ];
    }

    // Получить все элементы документации для QuickPick
    getAllDocumentItems() {
        return this.allDocumentItems;
    }

    // Найти элемент по ID
    findDocumentItemById(id) {
        return this.allDocumentItems.find(item => item.id === id);
    }

    // Автоматическая загрузка при инициализации
    async autoLoadSupabase() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        console.log('🔄 Auto-loading documentation from Supabase...');
        
        // Показываем индикатор загрузки
        this.data[0].children = [
            new TreeItem('Загрузка документации с Supabase...', vscode.TreeItemCollapsibleState.None, 'loading')
        ];
        this._onDidChangeTreeData.fire();
        
        try {
            await this.loadFromSupabase();
            console.log('✅ Supabase data loaded automatically on startup');
        } catch (error) {
            console.error('❌ Auto-load failed:', error.message);
            
            // Более информативное сообщение об ошибке
            let errorDetail = '';
            if (error.message.includes('404')) {
                errorDetail = 'Таблицы не найдены. Проверьте:\n- websoft_documentation_developer_data\n- table_category';
            } else if (error.message.includes('нет ответа')) {
                errorDetail = 'Сервер Supabase недоступен';
            } else {
                errorDetail = error.message;
            }
            
            // Показываем сообщение об ошибке в дереве
            this.data[0].children = [
                new TreeItem('Ошибка загрузки данных', vscode.TreeItemCollapsibleState.None, 'error'),
                new TreeItem(errorDetail, vscode.TreeItemCollapsibleState.None, 'error'),
                new TreeItem('Нажмите "Load Documentation" для повторной попытки', vscode.TreeItemCollapsibleState.None, 'file')
            ];
            this._onDidChangeTreeData.fire();
            
            vscode.window.showErrorMessage(`Не удалось загрузить документацию: ${errorDetail}`);
        } finally {
            this.isLoading = false;
        }
    }

    // Группировка документов по названиям категорий
    groupDocumentsByCategory(documents) {
        return documents.reduce((acc, doc) => {
            if (doc.category) {
                const categoryTitle = doc.categoryTitle || 'Без категории';
                if (!acc.has(categoryTitle)) {
                    acc.set(categoryTitle, []);
                }
                acc.get(categoryTitle).push(doc);
            }
            return acc;
        }, new Map());
    }

    getTreeItem(element) {
        console.log(`[getTreeItem] ${element.label} - state:`, element.collapsibleState);
        return element;
    }

    getChildren(element) {
        if (!element) {
            return this.data;
        }
        return element.children;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    // Получение статистики для информационной панели
    getStats() {
        const totalDocuments = this.supabaseData.length;
        const categoriesCount = this.categoriesMap.size;
        const functionsCount = this.supabaseData.filter(doc => doc.type === 'function').length;
        const documentsCount = this.supabaseData.filter(doc => doc.type !== 'function').length;
        const uncategorizedCount = this.supabaseData.filter(doc => !doc.category).length;

        // console.log(this.loadFromSupabase());
        console.log(totalDocuments);

        return {
            totalDocuments,
            categoriesCount,
            functionsCount,
            documentsCount,
            uncategorizedCount
        };
    }

    // Поиск документов с учетом категорий
    searchDocuments(query) {
        if (!query) return this.allDocumentItems;
        
        const searchTerm = query.toLowerCase();
        return this.allDocumentItems.filter(doc => 
            (doc.title && doc.title.toLowerCase().includes(searchTerm)) ||
            (doc.description && doc.description.toLowerCase().includes(searchTerm)) ||
            (doc.syntax && doc.syntax.toLowerCase().includes(searchTerm)) ||
            (doc.arguments && doc.arguments.toLowerCase().includes(searchTerm)) ||
            (doc.return && doc.return.toLowerCase().includes(searchTerm)) ||
            (doc.content && doc.content.toLowerCase().includes(searchTerm)) ||
            (doc.example_code && doc.example_code.toLowerCase().includes(searchTerm)) ||
            (doc.categoryTitle && doc.categoryTitle.toLowerCase().includes(searchTerm))
        );
    }
}

// Провайдер для информационной панели
class InfoDataProvider {
    constructor(treeDataProvider) {
        this.treeDataProvider = treeDataProvider;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        return element;
    }

    getChildren() {
        const stats = this.treeDataProvider.getStats();
        
        return [
            new vscode.TreeItem('📊 Supabase Documentation Statistics', vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem('', vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem(`📄 Всего документов: ${stats.totalDocuments}`, vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem(`📁 Категорий: ${stats.categories}`, vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem(`⚡ Функций: ${stats.functionsCount}`, vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem(`📝 Документов: ${stats.documentsCount}`, vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem('', vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem('🔄 Данные загружаются автоматически', vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem('🌐 Источник: Supabase', vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem('', vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem('🔍 Используйте QuickPick для быстрого поиска', vscode.TreeItemCollapsibleState.None),
            new vscode.TreeItem('   • Нажмите Ctrl+Shift+P → "Search Documentation"', vscode.TreeItemCollapsibleState.None)
        ];
    }
}

// Функция для создания HTML контента WebView
function getDocumentationHTML(item) {
    const docData = item.documentationData;

    const result = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    padding: 15px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    line-height: 1.6;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }
                .header {
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding: 0;
                    margin-bottom: 0;
                }
                h1 {
                    color: var(--vscode-textLink-foreground);
                    margin: 0 0 10px 0;
                    line-height: normal;
                }
                .argument-elem {
                    margin: 8px 0;
                }
                .argument-elem {
                    font-weight: italic;
                    color: var(--vscode-textLink-foreground);
                }
                .category {
                    display: inline-block;
                    padding: 4px 8px;
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    border-radius: 4px;
                    font-size: 12px;
                    margin-bottom: 10px;
                }
                .section {
                    margin: 0;
                    padding: 15px 0;
                    border-radius: 4px;
                }
                .section h3 {
                    margin-top: 0;
                    color: var(--vscode-textLink-foreground);
                    margin-bottom: 10px;
                }
                pre {
                    background: var(--vscode-textCodeBlock-background);
                    background: #272822;
                    background: var(--vscode-input-background);
                    padding: 15px;
                    border-radius: 4px;
                    overflow-x: auto;
                    white-space: pre-wrap;
                }
                code {
                    font-family: 'Cascadia Code', 'Fira Code', monospace;
                    color: var(--vscode-textLink-foreground);
                    background: none;
                }
                .property {
                    margin: 8px 0;
                }
                .property-name {
                    font-weight: bold;
                    color: var(--vscode-textLink-foreground);
                }
                .content {
                    line-height: 1.6;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${docData.title || 'Без названия'}</h1>
                <div class="category">${docData.categoryTitle || 'Без категории'}</div>
                ${docData.type ? `<div class="category">Тип: ${docData.type}</div>` : ''}
            </div>

            ${docData.description ? `
            <div class="section">
                <h3>📋 Описание</h3>
                <div class="content">${docData.description.replace(/\n/g, '<br>')}</div>
            </div>
            ` : ''}

            ${docData.syntax ? `
            <div class="section">
                <h3>📋 Синтаксис</h3>
                <pre><code>${docData.syntax}</code></pre>
            </div>
            ` : ''}

            ${docData.arguments ? `
            <div class="section">
                <h3>📋 Аргументы</h3>
                <div class="content">${docData.arguments.replace(/\n/g, '<br>')}</div>
            </div>
            ` : ''}

            ${docData.return ? `
            <div class="section">
                <h3>📋 Возвращаемое</h3>
                <div class="content">${docData.return.replace(/\n/g, '<br>')}</div>
            </div>
            ` : ''}

            ${docData.content ? `
            <div class="section">
                <h3>📝 Содержание</h3>
                <div class="content">${docData.content.replace(/\n/g, '<br>')}</div>
            </div>
            ` : ''}

            ${docData.example_code ? `
            <div class="section">
                <h3>💡 Пример кода</h3>
                <pre><code>${docData.example_code}</code></pre>
            </div>
            ` : ''}

            ${docData.parameters ? `
            <div class="section">
                <h3>⚙️ Параметры</h3>
                <pre><code>${JSON.stringify(docData.parameters, null, 2)}</code></pre>
            </div>
            ` : ''}

            <div class="section">
                <h3>🌐 Информация о документе</h3>
                <div class="property">
                    <span class="property-name">ID:</span> ${docData.id}
                </div>
                ${docData.created_at ? `
                <div class="property">
                    <span class="property-name">Создан:</span> ${new Date(docData.created_at).toLocaleDateString()}
                </div>
                ` : ''}
                ${docData.updated_at ? `
                <div class="property">
                    <span class="property-name">Обновлен:</span> ${new Date(docData.updated_at).toLocaleDateString()}
                </div>
                ` : ''}
                <div class="property">
                    <span class="property-name">Источник:</span> Supabase
                </div>
            </div>
        </body>
        </html>
    `;
    console.log(result);
    console.log(`Получен HTML для документа: ${docData.title}`);
    return result;
}

function activate(context) {
    console.log('TreeView Activity Bar extension activated');
    console.log('Axios version:', axios.VERSION);

    // Менеджер для управления панелями документации
    let activeDocumentationPanel = null;

    // Создаем провайдеры данных
    const treeDataProvider = new TreeDataProvider();
    const infoDataProvider = new InfoDataProvider(treeDataProvider);

    // Регистрируем TreeView в activity bar
    const treeView = vscode.window.createTreeView('treeview-activitybar-demo.treeView', {
        treeDataProvider: treeDataProvider,
        showCollapseAll: true
    });

    const infoView = vscode.window.createTreeView('treeview-activitybar-demo.infoView', {
        treeDataProvider: infoDataProvider
    });

    // Автоматически загружаем данные при активации расширения
    setTimeout(() => {
        treeDataProvider.autoLoadSupabase().then(() => {
            // Обновляем информационную панель после загрузки
            infoDataProvider.refresh();
        });
    }, 1000);

    // Обработчик выбора элемента в дереве
    treeView.onDidChangeSelection(event => {
        if (event.selection.length > 0) {
            const selectedItem = event.selection[0];
            if (selectedItem.id) {
                vscode.window.showInformationMessage(`Выбрано: ${selectedItem.label}`);
            }
        }
    });

    // Функция для QuickPick поиска документации
    async function showDocumentationQuickPick() {
        const documents = treeDataProvider.getAllDocumentItems();
        
        if (documents.length === 0) {
            vscode.window.showWarningMessage('Нет загруженной документации. Сначала загрузите данные с Supabase.');
            return;
        }

        const items = documents.map(doc => ({
            label: doc.title || 'Без названия',
            // description: doc.category || 'Без категории',
            detail: doc.description ? doc.description.substring(0, 60) + '...' : 'Описание отсутствует',
            id: doc.id,
            docData: doc
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '🔍 Поиск документации по названию или категории...',
            matchOnDescription: true,
            matchOnDetail: true,
            canPickMany: false
        });

        if (selected) {
            // Показываем документацию
            vscode.commands.executeCommand('treeview-activitybar-demo.showDocumentation', {
                documentationData: selected.docData,
                label: selected.label,
                id: selected.id
            });
        }
    }

    // Функция для фильтрованного поиска по категориям
    async function showFilteredDocumentationQuickPick() {
        const documents = treeDataProvider.getAllDocumentItems();
        
        if (documents.length === 0) {
            vscode.window.showWarningMessage('Нет загруженной документации. Сначала загрузите данные с Supabase.');
            return;
        }

        // Получаем уникальные категории
        const categories = [...new Set(documents.map(doc => doc.category || 'Без категории'))];
        
        const categoryItems = categories.map(category => ({
            label: category,
            description: `Документы в категории "${category}"`,
            category: category
        }));

        const selectedCategory = await vscode.window.showQuickPick(categoryItems, {
            placeHolder: '🎯 Выберите категорию для поиска...'
        });

        if (!selectedCategory) return;

        // Фильтруем документы по выбранной категории
        const filteredDocs = documents.filter(doc => 
            (doc.category || 'Без категории') === selectedCategory.category
        );

        if (filteredDocs.length === 0) {
            vscode.window.showInformationMessage(`Нет документов в категории: ${selectedCategory.label}`);
            return;
        }

        const items = filteredDocs.map(doc => ({
            label: doc.title || 'Без названия',
            description: doc.category || 'Без категории',
            detail: doc.description ? doc.description.substring(0, 60) + '...' : 'Описание отсутствует',
            id: doc.id,
            docData: doc
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `🔍 Документы в категории "${selectedCategory.label}"...`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            vscode.commands.executeCommand('treeview-activitybar-demo.showDocumentation', {
                documentationData: selected.docData,
                label: selected.label,
                id: selected.id
            });
        }
    }

    // Регистрируем команды
    const commands = [
        vscode.commands.registerCommand('treeview-activitybar-demo.refresh', () => {
            treeDataProvider.loadFromSupabase().then(() => {
                infoDataProvider.refresh();
            });
        }),

        vscode.commands.registerCommand('treeview-activitybar-demo.loadFromSupabase', () => {
            treeDataProvider.loadFromSupabase().then(() => {
                infoDataProvider.refresh();
            });
        }),

        // vscode.commands.registerCommand('treeview-activitybar-demo.showDocumentation', async (item) => {
        //     if (!item.documentationData) {
        //         vscode.window.showWarningMessage('Нет данных для отображения документации');
        //         return;
        //     }

        //     try {
        //         const panel = vscode.window.createWebviewPanel(
        //             'documentationView',
        //             `📚 ${item.documentationData.title || 'Документация'}`,
        //             vscode.ViewColumn.Beside,
        //             {
        //                 enableScripts: true,
        //                 retainContextWhenHidden: true,
        //                 localResourceRoots: []
        //             }
        //         );

        //         panel.webview.html = getDocumentationHTML(item);

        //     } catch (error) {
        //         vscode.window.showErrorMessage(`Ошибка при открытии документации: ${error.message}`);
        //     }
        // }),

        // QuickPick команды
        vscode.commands.registerCommand('treeview-activitybar-demo.showDocumentation', async (item) => {
            if (!item.documentationData) {
                vscode.window.showWarningMessage('Нет данных для отображения документации');
                return;
            }

            try {
                // Закрываем предыдущую панель документации
                if (activeDocumentationPanel) {
                    activeDocumentationPanel.dispose();
                }

                // Создаем новую панель
                activeDocumentationPanel = vscode.window.createWebviewPanel(
                    'documentationView',
                    `📚 ${item.documentationData.title || 'Документация'}`,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        localResourceRoots: []
                    }
                );

                // Устанавливаем HTML контент
                activeDocumentationPanel.webview.html = getDocumentationHTML(item);

                // Обработчик закрытия панели
                activeDocumentationPanel.onDidDispose(() => {
                    activeDocumentationPanel = null;
                }, null, context.subscriptions);

            } catch (error) {
                vscode.window.showErrorMessage(`Ошибка при открытии документации: ${error.message}`);
            }
        }),

        // Команда для явного закрытия всех панелей
        vscode.commands.registerCommand('treeview-activitybar-demo.closeAllDocumentation', () => {
            if (activeDocumentationPanel) {
                activeDocumentationPanel.dispose();
                activeDocumentationPanel = null;
                vscode.window.showInformationMessage('Все панели документации закрыты');
            }
        }),

        vscode.commands.registerCommand('treeview-activitybar-demo.searchDocumentation', showDocumentationQuickPick),
        vscode.commands.registerCommand('treeview-activitybar-demo.filterDocumentation', showFilteredDocumentationQuickPick)
    ];

    // Добавляем все в контекст
    commands.forEach(command => context.subscriptions.push(command));
    context.subscriptions.push(treeView);
    context.subscriptions.push(infoView);

    // Добавляем кнопку в статусную строку для быстрого доступа
    const quickPickStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    quickPickStatusBar.text = '$(search) Search Docs';
    quickPickStatusBar.tooltip = 'Быстрый поиск документации';
    quickPickStatusBar.command = 'treeview-activitybar-demo.searchDocumentation';
    quickPickStatusBar.show();
    context.subscriptions.push(quickPickStatusBar);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};