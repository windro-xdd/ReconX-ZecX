import React from 'react'
import { createRoot } from 'react-dom/client'
import { Dashboard } from './modules/Dashboard'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(
	<div style={{maxWidth:1100, margin:'0 auto', padding:20}}>
		<Dashboard />
	</div>
)
