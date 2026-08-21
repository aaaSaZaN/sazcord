// Тонкий ре-экспорт: исторически окно настроек жило одним файлом
// SettingsPanel.tsx (~2000 строк). С версии 0.7.0 оно разнесено по
// отдельным файлам в ./settings/* (по табам), а сам компонент-оркестратор
// — в ./settings/SettingsPanel.tsx. Этот файл оставлен, чтобы не править
// все lazy-импорты в Home/CallView/GroupCallView.

export { default } from './settings/SettingsPanel';
