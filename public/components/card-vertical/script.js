const load = async (container, { id, placedPosition = null, hp = null }) => {
  if (id === null) return;

  const response = await fetch(`/cards/${id}`);
  if (!response.ok) return console.error(await response.text());
  const data = await response.json();

  // name
  container.querySelector(".card-name").innerText = data.name;
  // artwork
  container.querySelector(".card-artwork").style.backgroundImage = `url("${data.artworkPath}")`;
  // traits
  // affiliations
  // abilities
  const abilitiesList = container.querySelector(".card-abilities");
  abilitiesList.innerHTML = "";
  for (let ability of data.abilities) {
    const li = document.createElement("li");
    li.innerText = ability;
    abilitiesList.appendChild(li);
  }
  // shinsu
  container.querySelector(".card-shinsu").innerText = data.cost;
  // positions
  const positionsList = container.querySelector(".card-positions");
  positionsList.innerHTML = "";
  for (let code in data.positions) {
    const li = document.createElement("li");
    console.log(`url("${data.positions[code].iconPath}")`);
    li.style.backgroundImage = `url("${data.positions[code].iconPath}")`;
    positionsList.appendChild(li);
  }
  // hp
  container.querySelector(".card-hp").innerText = hp || data.hp;
};

export default load;
