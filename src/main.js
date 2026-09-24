import { VRButton } from '../vendor/VRButton.js';
import { Game } from './game.js';

const game = new Game(document.getElementById('app'));
window.__game = game;               // pro ladění a automatické testy

const vrBtn = VRButton.createButton(game.renderer);
vrBtn.id = 'vr-button';
document.getElementById('buttons').appendChild(vrBtn);

document.getElementById('play').addEventListener('click', () => {
  document.getElementById('intro').classList.add('hidden');
  game.renderer.domElement.requestPointerLock?.();
  game.startGame();
});
game.renderer.xr.addEventListener('sessionstart', () => {
  document.getElementById('intro').classList.add('hidden');
  game.showMenu();
});
game.renderer.xr.addEventListener('sessionend', () => {
  document.getElementById('intro').classList.remove('hidden');
});
