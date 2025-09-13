// scripts.js
const container = d3.select("#container");

// 为每个轨迹图设置固定宽度和高度
const chartWidth = 1400;
const chartHeight = 600;
const margin = { top: 20, right: 20, bottom: 50, left: 50 };

// 设置横向拖动范围扩展因子（1表示不扩展，2表示扩展1倍等）
const horizontalExtentFactor = 5;  // 增加扩展因子从3到5

// 页面加载完成后初始化图表
document.addEventListener('DOMContentLoaded', function() {
    loadAllTracksAndRender();
});

// 从全局变量TRACK_FILES加载所有轨迹文件并渲染图表
function loadAllTracksAndRender() {
    if (typeof TRACK_FILES === 'undefined' || !Array.isArray(TRACK_FILES)) {
        console.error("TRACK_FILES is not defined. Please run the generation script.");
        container.append("p").text("错误: 找不到轨迹文件列表。请先运行 'generate_html.py' 脚本。");
        return;
    }

    if (TRACK_FILES.length === 0) {
        container.append("p").text("在 'tracks' 文件夹中没有找到JSON文件。");
        return;
    }

    const promises = TRACK_FILES.map(file => {
        return fetch(`../tracks/${file}`).then(response => {
            if (!response.ok) {
                throw new Error(`Network response was not ok for ${file}`);
            }
            return response.json();
        });
    });

    Promise.all(promises)
        .then(allData => {
            container.selectAll("*").remove(); // 清除加载提示
            allData.forEach((data, index) => {
                renderChart(data, TRACK_FILES[index]);
            });
            addControlEventListeners(); // 所有图表渲染完后添加事件监听器
        })
        .catch(error => {
            console.error('加载一个或多个轨迹时出错:', error);
            container.selectAll("*").remove();
            container.append("p").text(`加载轨迹数据时出错: ${error.message}`);
        });
}


// 渲染单个图表
function renderChart(jsonData, fileName) {
    // 为所有轨迹创建一个统一的包装容器
    const chartWrapper = container.append("div")
        .attr("class", "chart-wrapper");

    // 创建图表容器
    const chartContainer = chartWrapper.append("div")
        .attr("class", "chart-container");

    // 添加标题
    chartContainer.append("h3")
        .text(`轨迹图 - ${fileName}`)
        .style("margin", "10px");

    const svg = chartContainer.append("svg")
        .attr("width", chartWidth)
        .attr("height", chartHeight)
        .style("display", "block");

    // 创建一个组元素用于缩放和平移
    const g = svg.append("g");

    // 处理所有轨迹数据
    let allPaths = [];
    let trajectories = [];

    // 解析新的数据格式
    // 第一个元素：全量轨迹点
    const fullTrajectories = jsonData[0] || [];
    // 第二个元素：子段轨迹
    const subTrajectories = jsonData[1] || [];
    // 第三个元素：目标信息
    const targetInfos = jsonData[2] || [];

    // 处理全量轨迹
    fullTrajectories.forEach((trajectory, index) => {
        const processedPath = trajectory.map(point => {
            return {
                x: parseFloat(point.longitude),
                y: parseFloat(point.latitude),
                lastTm: point.lastTm,
                lastdt: point.lastdt,
                course: point.course,
                speed: point.speed,
                type: 'full'
            };
        });

        allPaths = allPaths.concat(processedPath);
        trajectories.push({
            id: `全量轨迹-${index + 1}`,
            path: processedPath,
            type: 'full',
            isOriginal: true, // 标记为原始轨迹
            index: index
        });
    });

    // 处理子段轨迹
    subTrajectories.forEach((trajectory, index) => {
        const processedPath = trajectory.map(point => {
            return {
                x: parseFloat(point.longitude),
                y: parseFloat(point.latitude),
                lastTm: point.lastTm,
                lastdt: point.lastdt,
                course: point.course,
                speed: point.speed,
                type: 'sub'
            };
        });

        allPaths = allPaths.concat(processedPath);
        trajectories.push({
            id: `子段轨迹-${index + 1}`,
            path: processedPath,
            type: 'sub',
            isOriginal: false, // 不是原始轨迹
            index: fullTrajectories.length + index // 索引从全量轨迹之后开始
        });
    });

    if (allPaths.length === 0) return;

    // 计算X轴和Y轴数据范围
    const maxX = d3.max(allPaths, d => d.x);
    const minX = d3.min(allPaths, d => d.x);
    const maxY = d3.max(allPaths, d => d.y);
    const minY = d3.min(allPaths, d => d.y);

    // 扩展X轴范围以允许更多横向拖动
    const rangeX = maxX - minX;
    const extendedMaxX = maxX + rangeX * (horizontalExtentFactor - 1) / 2;
    const extendedMinX = minX - rangeX * (horizontalExtentFactor - 1) / 2;

    // 扩展Y轴范围
    const rangeY = maxY - minY;
    const extendedMaxY = maxY + rangeY * 0.1;
    const extendedMinY = minY - rangeY * 0.1;

    // 添加缩放功能
    const zoom = d3.zoom()
        .scaleExtent([0.2, 10])  // 扩大缩放范围，允许更小的缩放比例
        .extent([[0, 0], [chartWidth, chartHeight]])  // 设置缩放的参考区域
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            // 缩放时更新标签显示
            updateLabelsVisibility(svg, jsonData);
        });

    // 将缩放行为应用到SVG
    svg.call(zoom);

    // 创建坐标轴的缩放比例
    const xScale = d3.scaleLinear()
        .domain([extendedMinX, extendedMaxX])  // 使用扩展后的范围
        .range([margin.left, chartWidth - margin.right]);

    const yScale = d3.scaleLinear()
        .domain([extendedMinY, extendedMaxY])
        .range([chartHeight - margin.bottom, margin.top]);

    // 为不同轨迹定义不同的颜色
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

    // 为每条轨迹绘制线条和点
    trajectories.forEach((trajectory, index) => {
        const line = d3.line()
            .x(d => xScale(d.x))
            .y(d => yScale(d.y));

        // 绘制轨迹线
        const trajectoryLine = g.append("path")
            .datum(trajectory.path)
            .attr("class", `trajectory-line trajectory-${index}`)
            .attr("d", line)
            .style("stroke", colorScale(index))
            .style("fill", "none")
            .style("stroke-width", 1) // 更细的线
            .style("stroke-dasharray", trajectory.type === 'full' ? "5,5" : ""); // 全量轨迹用虚线

        // 绘制轨迹点
        const trackPoints = g.selectAll(`circle.track-${index}`)
            .data(trajectory.path)
            .enter().append("circle")
            .attr("class", `track-point track-${index}`)
            .attr("cx", d => xScale(d.x))
            .attr("cy", d => yScale(d.y))
            .attr("r", trajectory.type === 'full' ? 0.5 : 4) // 全量轨迹点半径更小但可见
            .style("fill", trajectory.type === 'full' ? colorScale(index) : colorScale(index)) // 全量轨迹点和子段轨迹点都使用彩色
            // 添加鼠标悬停事件
            .on("mouseover", function(event, d) {
                // 创建提示框
                const tooltip = g.append("g")
                    .attr("class", "tooltip")
                    .attr("transform", `translate(${xScale(d.x) + 10}, ${yScale(d.y) - 10})`);

                // 添加背景矩形
                tooltip.append("rect")
                    .attr("x", +5)
                    .attr("y", -35)
                    .attr("width", 180)
                    .attr("height", 80)
                    .attr("fill", "white")
                    .attr("stroke", "#ccc")
                    .attr("stroke-width", 1)
                    .attr("rx", 10)
                    .attr("ry", 4);

                // 添加文本信息
                tooltip.append("text")
                    .attr("x", 10)
                    .attr("y", -20)
                    .text(`经度: ${d.x.toFixed(6)}`)
                    .style("font-size", "12px")
                    .style("fill", "#333");

                tooltip.append("text")
                    .attr("x", 10)
                    .attr("y", -5)
                    .text(`纬度: ${d.y.toFixed(6)}`)
                    .style("font-size", "12px")
                    .style("fill", "#333");

                // 显示时间信息
                let timeText = "时间: ";
                if (d.lastdt) {
                    timeText += d.lastdt;
                } else if (d.lastTm) {
                    timeText += new Date(d.lastTm).toLocaleString();
                } else {
                    timeText += "无时间信息";
                }

                tooltip.append("text")
                    .attr("x", 10)
                    .attr("y", 10)
                    .text(timeText)
                    .style("font-size", "12px")
                    .style("fill", "#333");

                // 显示速度信息
                const speedText = d.speed !== undefined ? `速度: ${d.speed} 节` : "无速度信息";
                tooltip.append("text")
                    .attr("x", 10)
                    .attr("y", 25)
                    .text(speedText)
                    .style("font-size", "12px")
                    .style("fill", "#333");

                // 将提示框存储在元素数据中，便于后续移除
                d3.select(this).datum().tooltip = tooltip;
            })
            .on("mouseout", function(event, d) {
                // 移除提示框
                const tooltip = d3.select(this).datum().tooltip;
                if (tooltip) {
                    tooltip.remove();
                }
            });

        // 添加时间标签（默认隐藏）
        const timeLabels = g.selectAll(`text.time-label-${index}`)
            .data(trajectory.path)
            .enter().append("text")
            .attr("class", `info-label time-label time-label-${index}`)
            .attr("x", d => xScale(d.x) - 10)
            .attr("y", d => yScale(d.y) - 10)
            .text(d => {
                // 如果存在lastdt字段，只保留时间部分，否则显示完整日期时间
                if (d.lastdt) {
                    // 检查lastdt是否包含时间和日期，如果是，则只取时间部分
                    if (d.lastdt.includes(' ')) {
                        const timePart = d.lastdt.split(' ')[1];
                        return timePart || d.lastdt;
                    }
                    return d.lastdt;
                }
                // 如果存在lastTm字段，则格式化为日期时间
                if (d.lastTm) {
                    return new Date(d.lastTm).toLocaleString();
                }
                return ''; // 如果都没有，则返回空字符串而不是"invalid"
            })
            .style("font-size", "5px")
            .style("fill", colorScale(index))
            .style("display", "none"); // 默认隐藏

        // 添加航向标签（默认隐藏）
        const courseLabels = g.selectAll(`text.course-label-${index}`)
            .data(trajectory.path)
            .enter().append("text")
            .attr("class", `info-label course-label course-label-${index}`)
            .attr("x", d => xScale(d.x) + 10)
            .attr("y", d => yScale(d.y) + 15)
            .text(d => d.course !== undefined ? `${d.course}度` : "")
            .style("font-size", "5px")
            .style("fill", colorScale(index))
            .style("display", "none"); // 默认隐藏

        // 添加航速标签（默认隐藏）
        const speedLabels = g.selectAll(`text.speed-label-${index}`)
            .data(trajectory.path)
            .enter().append("text")
            .attr("class", `info-label speed-label speed-label-${index}`)
            .attr("x", d => xScale(d.x) -10)
            .attr("y", d => yScale(d.y) + 8)
            .text(d => d.speed !== undefined ? `${d.speed}节` : "")
            .style("font-size", "5px")
            .style("fill", colorScale(index))
            .style("display", "none"); // 默认隐藏

        // 绘制起点标识（使用最后一个点作为起点）
        const startPoints = g.append("rect")
            .attr("class", `start-point start-point-${index}`)
            .attr("x", xScale(trajectory.path[trajectory.path.length - 1].x) - 10)
            .attr("y", yScale(trajectory.path[trajectory.path.length - 1].y) - 10)
            .attr("width", 20)
            .attr("height", 20)
            .style("fill", "green")
            .style("stroke", colorScale(index))
            .style("stroke-width", "2px")
            // 添加鼠标悬停事件
            .on("mouseover", function(event) {
                // 获取起点数据
                const startPoint = trajectory.path[trajectory.path.length - 1];

                // 创建提示框
                const tooltip = g.append("g")
                    .attr("class", "tooltip")
                    .attr("transform", `translate(${xScale(startPoint.x) + 15}, ${yScale(startPoint.y) - 15})`);

                // 添加背景矩形
                tooltip.append("rect")
                    .attr("x", +10)
                    .attr("y", -45)
                    .attr("width", 200)
                    .attr("height", 100)
                    .attr("fill", "white")
                    .attr("stroke", "#333")
                    .attr("stroke-width", 1)
                    .attr("rx", 6)
                    .attr("ry", 6);

                // 添加文本信息（使用更大的字体）
                tooltip.append("text")
                    .attr("x",+15)
                    .attr("y", -25)
                    .text(`经度: ${startPoint.x.toFixed(6)}`)
                    .style("font-size", "14px")
                    .style("fill", "#333")
                    .style("font-weight", "bold");

                tooltip.append("text")
                    .attr("x", +15)
                    .attr("y", -5)
                    .text(`纬度: ${startPoint.y.toFixed(6)}`)
                    .style("font-size", "14px")
                    .style("fill", "#333")
                    .style("font-weight", "bold");

                // 显示时间信息
                let timeText = "时间: ";
                if (startPoint.lastdt) {
                    timeText += startPoint.lastdt;
                } else if (startPoint.lastTm) {
                    timeText += new Date(startPoint.lastTm).toLocaleString();
                } else {
                    timeText += "无时间信息";
                }

                tooltip.append("text")
                    .attr("x", +15)
                    .attr("y", 15)
                    .text(timeText)
                    .style("font-size", "14px")
                    .style("fill", "#333")
                    .style("font-weight", "bold");

                // 显示速度信息
                const speedText = startPoint.speed !== undefined ? `速度: ${startPoint.speed} 节` : "无速度信息";
                tooltip.append("text")
                    .attr("x", +15)
                    .attr("y", 35)
                    .text(speedText)
                    .style("font-size", "14px")
                    .style("fill", "#333")
                    .style("font-weight", "bold");

                // 将提示框存储在元素数据中，便于后续移除
                d3.select(this).datum({tooltip: tooltip});
            })
            .on("mouseout", function(event) {
                // 移除提示框
                const data = d3.select(this).datum();
                if (data && data.tooltip) {
                    data.tooltip.remove();
                }
            });

        // 默认隐藏原始轨迹元素
        if (trajectory.isOriginal) {
            trajectoryLine.style("display", "none");
            trackPoints.style("display", "none");
            startPoints.style("display", "none");
        }
    });

    // 创建信息显示区域
    const infoContainer = chartWrapper.append("div")
        .attr("class", "chart-info");

    // 显示目标信息
    if (targetInfos && Array.isArray(targetInfos)) {
        targetInfos.forEach((target, index) => {
            const targetInfo = infoContainer.append("div")
                .attr("class", "target-info");

            if (target.case_num !== undefined) {
                targetInfo.append("div")
                    .html(`测试组: ${target.case_num}`);
            }

            if (target.direction) {
                targetInfo.append("div")
                    .html(`样本: ${target.direction}`);
            }
            if (target.id) {
                targetInfo.append("div")
                    .html(`ID1：${target.id}`);
            }

            if (target.id1_starttime) {
                targetInfo.append("div")
                    .html(`出现时间: ${target.id1_starttime}`);
            }

            if (target.id1_endtime) {
                targetInfo.append("div")
                    .html(`消失时间: ${target.id1_endtime}`);
            }

            if (target.gap_range) {
                targetInfo.append("div")
                    .html(`间隔时间: ${target.gap_range}分钟`);
            }

            if (target.id2) {
                targetInfo.append("div")
                    .html(`ID2：${target.id2}`);

                if (target.id2_starttime) {
                    targetInfo.append("div")
                        .html(`出现时间: ${target.id2_starttime}`);
                }

                if (target.id2_endtime) {
                    targetInfo.append("div")
                        .html(`消失时间: ${target.id2_endtime}`);
                }
            }


        });
    }

    // 更新标签可见性
    updateLabelsVisibility(svg, jsonData);
}

// 更新标签可见性，只显示当前视图中的标签，并考虑轨迹是否可见
function updateLabelsVisibility(svg, jsonData) {
    const showTime = document.getElementById('showTime');
    const showCourse = document.getElementById('showCourse');
    const showSpeed = document.getElementById('showSpeed');
    const showOriginal = document.getElementById('showOriginal');

    // 获取当前SVG的变换矩阵
    const g = svg.select("g");
    const transform = d3.zoomTransform(svg.node());

    // 获取当前视图的边界
    const bounds = {
        x: -transform.x / transform.k,
        y: -transform.y / transform.k,
        width: svg.node().clientWidth / transform.k,
        height: svg.node().clientHeight / transform.k
    };

    // 检查原始轨迹是否可见
    const isOriginalVisible = showOriginal && showOriginal.checked;

    // 获取全量轨迹数量
    const fullTrajectoriesCount = (jsonData[0] || []).length;

    // 更新时间标签
    g.selectAll(".time-label").style("display", function() {
        if (!showTime || !showTime.checked) return "none";

        const label = d3.select(this);
        const x = parseFloat(label.attr("x"));
        const y = parseFloat(label.attr("y"));

        // 检查标签是否在当前视图中
        if (x >= bounds.x && x <= bounds.x + bounds.width &&
            y >= bounds.y && y <= bounds.y + bounds.height) {
            // 检查标签所属的轨迹是否可见
            const classList = this.classList;
            for (let i = 0; i < classList.length; i++) {
                const cls = classList[i];
                if (cls.startsWith('time-label-')) {
                    const index = parseInt(cls.split('-')[2]);
                    // 如果是原始轨迹但未显示，则不显示标签
                    if (index < fullTrajectoriesCount && !isOriginalVisible) {
                        return "none";
                    }
                    return "block";
                }
            }
        }
        return "none";
    });

    // 更新航向标签
    g.selectAll(".course-label").style("display", function() {
        if (!showCourse || !showCourse.checked) return "none";

        const label = d3.select(this);
        const x = parseFloat(label.attr("x"));
        const y = parseFloat(label.attr("y"));

        // ���查标签是否在当前视图中
        if (x >= bounds.x && x <= bounds.x + bounds.width &&
            y >= bounds.y && y <= bounds.y + bounds.height) {
            // 检查标签所属的轨迹是否可见
            const classList = this.classList;
            for (let i = 0; i < classList.length; i++) {
                const cls = classList[i];
                if (cls.startsWith('course-label-')) {
                    const index = parseInt(cls.split('-')[2]);
                    // 如果是原始轨迹但未显示，则不显示标签
                    if (index < fullTrajectoriesCount && !isOriginalVisible) {
                        return "none";
                    }
                    return "block";
                }
            }
        }
        return "none";
    });

    // 更新航速标签
    g.selectAll(".speed-label").style("display", function() {
        if (!showSpeed || !showSpeed.checked) return "none";

        const label = d3.select(this);
        const x = parseFloat(label.attr("x"));
        const y = parseFloat(label.attr("y"));

        // 检查标签是否在当前视图中
        if (x >= bounds.x && x <= bounds.x + bounds.width &&
            y >= bounds.y && y <= bounds.y + bounds.height) {
            // 检查标签所属的轨迹是否可见
            const classList = this.classList;
            for (let i = 0; i < classList.length; i++) {
                const cls = classList[i];
                if (cls.startsWith('speed-label-')) {
                    const index = parseInt(cls.split('-')[2]);
                    // 如果是原始轨迹但未显示，则不显示标签
                    if (index < fullTrajectoriesCount && !isOriginalVisible) {
                        return "none";
                    }
                    return "block";
                }
            }
        }
        return "none";
    });
}

// 添加控制按钮的事件监听器
function addControlEventListeners() {
    // 获取所有控制按钮
    const showTime = document.getElementById('showTime');
    const showCourse = document.getElementById('showCourse');
    const showSpeed = document.getElementById('showSpeed');
    const showGap = document.getElementById('showGap');
    const showOriginal = document.getElementById('showOriginal');

    // 为时间按钮添加事件监听器
    if (showTime) {
        showTime.addEventListener('change', function() {
            d3.selectAll('svg').each(function() {
                const svg = d3.select(this);
                const chartWrapper = svg.node().closest('.chart-wrapper');
                const fileName = d3.select(chartWrapper).select('h3').text().replace('轨迹图 - ', '');
                const trackIndex = TRACK_FILES.indexOf(fileName);
                if (trackIndex !== -1) {
                    fetch(`../tracks/${fileName}`)
                        .then(response => response.json())
                        .then(data => updateLabelsVisibility(svg, data));
                }
            });
        });
    }

    // 为航向按钮添加事件监听器
    if (showCourse) {
        showCourse.addEventListener('change', function() {
            d3.selectAll('svg').each(function() {
                const svg = d3.select(this);
                const chartWrapper = svg.node().closest('.chart-wrapper');
                const fileName = d3.select(chartWrapper).select('h3').text().replace('轨迹图 - ', '');
                fetch(`../tracks/${fileName}`)
                    .then(response => response.json())
                    .then(data => updateLabelsVisibility(svg, data));
            });
        });
    }

    // 为航速按钮添加事件监听器
    if (showSpeed) {
        showSpeed.addEventListener('change', function() {
            d3.selectAll('svg').each(function() {
                const svg = d3.select(this);
                const chartWrapper = svg.node().closest('.chart-wrapper');
                const fileName = d3.select(chartWrapper).select('h3').text().replace('轨迹图 - ', '');
                fetch(`../tracks/${fileName}`)
                    .then(response => response.json())
                    .then(data => updateLabelsVisibility(svg, data));
            });
        });
    }

    // 为原始轨迹按钮添加事件监听器
    if (showOriginal) {
        showOriginal.addEventListener('change', function() {
            d3.selectAll('svg').each(function() {
                const svg = d3.select(this);
                const g = svg.select("g");
                const chartWrapper = svg.node().closest('.chart-wrapper');
                const fileName = d3.select(chartWrapper).select('h3').text().replace('轨迹图 - ', '');
                fetch(`../tracks/${fileName}`)
                    .then(response => response.json())
                    .then(data => {
                         // 控制原始轨迹的显示/隐藏
                        const fullTrajectoriesCount = (data[0] || []).length;
                        if (showOriginal.checked) {
                            // 显示原始轨迹元素（jsonData[0]中的轨迹）
                            for (let i = 0; i < fullTrajectoriesCount; i++) {
                                g.selectAll(`.trajectory-${i}, .track-${i}, .start-point-${i}`).style("display", "block");
                            }
                        } else {
                            // 隐藏原始轨迹元素
                            for (let i = 0; i < fullTrajectoriesCount; i++) {
                                g.selectAll(`.trajectory-${i}, .track-${i}, .start-point-${i}`).style("display", "none");
                            }
                        }
                    });
            });
        });
    }

    // 初始化控件状态
    // 默认隐藏时间、航向、航速标签
    d3.selectAll(".time-label, .course-label, .speed-label").style("display", "none");

    // 确保初始状态正确
    const timeCheckbox = document.getElementById('showTime');
    const courseCheckbox = document.getElementById('showCourse');
    const speedCheckbox = document.getElementById('showSpeed');

    if (timeCheckbox && timeCheckbox.checked) {
        d3.selectAll('svg').each(function() {
            const svg = d3.select(this);
            const chartWrapper = svg.node().closest('.chart-wrapper');
            const fileName = d3.select(chartWrapper).select('h3').text().replace('轨迹图 - ', '');
            fetch(`../tracks/${fileName}`)
                .then(response => response.json())
                .then(data => updateLabelsVisibility(svg, data));
        });
    }

    if (courseCheckbox && courseCheckbox.checked) {
        d3.selectAll('svg').each(function() {
            const svg = d3.select(this);
            const chartWrapper = svg.node().closest('.chart-wrapper');
            const fileName = d3.select(chartWrapper).select('h3').text().replace('轨迹图 - ', '');
            fetch(`../tracks/${fileName}`)
                .then(response => response.json())
                .then(data => updateLabelsVisibility(svg, data));
        });
    }

    if (speedCheckbox && speedCheckbox.checked) {
        d3.selectAll('svg').each(function() {
            const svg = d3.select(this);
            const chartWrapper = svg.node().closest('.chart-wrapper');
            const fileName = d3.select(chartWrapper).select('h3').text().replace('轨迹图 - ', '');
            fetch(`../tracks/${fileName}`)
                .then(response => response.json())
                .then(data => updateLabelsVisibility(svg, data));
        });
    }
    
    if (showOriginal) {
        // 根据复选框的初始状态设置原始轨迹的显示状态
        d3.selectAll('svg').each(function() {
            const svg = d3.select(this);
            const g = svg.select("g");
            const chartWrapper = svg.node().closest('.chart-wrapper');
            const fileName = d3.select(chartWrapper).select('h3').text().replace('轨迹图 - ', '');
            fetch(`../tracks/${fileName}`)
                .then(response => response.json())
                .then(data => {
                    const fullTrajectoriesCount = (data[0] || []).length;
                    if (showOriginal.checked) {
                        for (let i = 0; i < fullTrajectoriesCount; i++) {
                            g.selectAll(`.trajectory-${i}, .track-${i}, .start-point-${i}`).style("display", "block");
                        }
                    } else {
                        for (let i = 0; i < fullTrajectoriesCount; i++) {
                            g.selectAll(`.trajectory-${i}, .track-${i}, .start-point-${i}`).style("display", "none");
                        }
                    }
                });
        });
    }
}