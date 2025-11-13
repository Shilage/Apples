// Wrapper per ReactDOM UMD
import "./react-dom.development.js"  // carica UMD → window.ReactDOM

const ReactDOM = window.ReactDOM
export default ReactDOM
export const { createRoot } = ReactDOM
