// Wrapper per React UMD
import "./react.development.js"  // carica UMD → window.React

const React = window.React
export default React
export const {
    useState,
    useEffect,
    useMemo,
    useCallback,
    useRef,
    Fragment,
    createElement
} = React
