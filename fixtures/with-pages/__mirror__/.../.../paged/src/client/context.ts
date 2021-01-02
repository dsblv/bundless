import react_cjsImport0 from "/web_modules/react/index.js?namespace=file";
const React = react_cjsImport0 && react_cjsImport0.__esModule ? react_cjsImport0.default : react_cjsImport0;;
export const MahoContext = React.createContext(null);
export const useMahoContext = () => {
  const context = React.useContext(MahoContext);
  if (!context) {
    throw new Error(`cannot get maho context`);
  }
  return context;
};

//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiL1VzZXJzL21vcnNlL0RvY3VtZW50cy9HaXRIdWIvZXNwYWNrL3BhZ2VkL3NyYy9jbGllbnQvY29udGV4dC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IFJlYWN0IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgSGVsbWV0RGF0YSB9IGZyb20gJ3JlYWN0LWhlbG1ldCdcblxuZXhwb3J0IGNvbnN0IE1haG9Db250ZXh0ID0gUmVhY3QuY3JlYXRlQ29udGV4dDx7XG4gICAgdXJsPzogc3RyaW5nXG4gICAgaGVsbWV0PzogSGVsbWV0RGF0YVxuICAgIHN0YXR1c0NvZGU/OiBudW1iZXJcbiAgICByb3V0ZURhdGE/OiB7IFtwYXRoOiBzdHJpbmddOiBhbnkgfVxufSB8IG51bGw+KG51bGwpXG5cbmV4cG9ydCBjb25zdCB1c2VNYWhvQ29udGV4dCA9ICgpID0+IHtcbiAgICBjb25zdCBjb250ZXh0ID0gUmVhY3QudXNlQ29udGV4dChNYWhvQ29udGV4dClcbiAgICBpZiAoIWNvbnRleHQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBjYW5ub3QgZ2V0IG1haG8gY29udGV4dGApXG4gICAgfVxuICAgIHJldHVybiBjb250ZXh0XG59XG4iXSwKICAibWFwcGluZ3MiOiAiQUFBQTtBQUdPLGFBQU0sY0FBYyxNQUFNLGNBS3ZCO0FBRUgsOEJBQXVCO0FBQzFCLGtCQUFnQixNQUFNLFdBQVc7QUFDakMsTUFBSSxDQUFDO0FBQ0QsVUFBTSxJQUFJLE1BQU07QUFBQTtBQUVwQixTQUFPO0FBQUE7IiwKICAibmFtZXMiOiBbXQp9Cg==